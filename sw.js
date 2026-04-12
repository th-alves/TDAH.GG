// =============================================================================
// app.js — TDAH.GG Riot Import
// =============================================================================

(function () {
  'use strict';

  // ---- Estado ----
  let currentData      = null;
  let sortBy           = 'games';
  let filterText       = '';
  let showOnlyFirst    = true;    // apenas 1º lugar (padrão ativo)
  let showUnplayed     = false;   // campeões ainda não jogados
  let currentPatchOnly = true;    // filtrar pelo patch atual (padrão: ativo)
  let allChampionIds   = [];      // todos os champs do DDragon

  // ---- DOM ----
  const form           = document.getElementById('search-form');
  const inputName      = document.getElementById('input-name');
  const inputTag       = document.getElementById('input-tag');
  const inputRegion    = document.getElementById('input-region');
  const inputCount     = document.getElementById('input-count');
  const btnSearch      = document.getElementById('btn-search');
  const heroSection    = document.getElementById('hero');
  const resultsSection = document.getElementById('results');
  const champGrid      = document.getElementById('champ-grid');
  const filterInput    = document.getElementById('filter-input');
  const sortSelect     = document.getElementById('sort-select');
  const firstToggle    = document.getElementById('first-toggle');
  const unplayedToggle = document.getElementById('unplayed-toggle');  // NOVO
  const patchToggle    = document.getElementById('patch-toggle');      // NOVO
  const statGames      = document.getElementById('stat-games');
  const statWins       = document.getElementById('stat-wins');
  const statWinrate    = document.getElementById('stat-winrate');
  const statChamps     = document.getElementById('stat-champs');
  const playerBadge    = document.getElementById('player-badge');
  const errorBox       = document.getElementById('error-box');
  const loadingBox     = document.getElementById('loading-box');

  // ---- Utilitários ----
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function wrColor(wr) {
    if (wr >= 60) return 'wr-high';
    if (wr >= 50) return 'wr-mid';
    return 'wr-low';
  }

  function placementEmoji(avg) {
    if (!avg) return '';
    if (avg <= 1.5) return '🥇';
    if (avg <= 2.5) return '🥈';
    if (avg <= 4)   return '🎖️';
    return '💀';
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const d = Math.floor(diff / 86400000);
    if (d === 0) return 'hoje';
    if (d === 1) return 'ontem';
    if (d < 7)  return `${d}d atrás`;
    if (d < 30) return `${Math.floor(d / 7)}sem atrás`;
    if (d < 365) return `${Math.floor(d / 30)}meses atrás`;
    return `${Math.floor(d / 365)}a atrás`;
  }

  // ---- Re-computa stats de campeão a partir de uma lista de partidas ----
  function computeChampStats(matches) {
    const champStats = {};
    for (const m of matches) {
      const { champion, win, placement, date } = m;
      if (!champStats[champion]) {
        champStats[champion] = { wins: 0, losses: 0, firstPlaceWins: 0, placements: [], lastPlayed: 0 };
      }
      if (win) champStats[champion].wins++;
      else     champStats[champion].losses++;
      if (placement === 1) champStats[champion].firstPlaceWins++;
      champStats[champion].placements.push(placement);
      if (date > champStats[champion].lastPlayed) champStats[champion].lastPlayed = date;
    }
    for (const stats of Object.values(champStats)) {
      stats.avgPlacement = stats.placements.length
        ? +(stats.placements.reduce((a, b) => a + b, 0) / stats.placements.length).toFixed(1)
        : null;
      stats.games   = stats.wins + stats.losses;
      stats.winrate = stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0;
    }
    return champStats;
  }

  // ---- Retorna os campeões ativos (respeitando filtro de patch) ----
  function getActiveChampions() {
    if (!currentData) return {};
    // Sempre recalcula no client para garantir firstPlaceWins disponível
    const matches = currentPatchOnly
      ? currentData.matches.filter(m => m.date >= getPatchStartTimestamp())
      : currentData.matches;
    return computeChampStats(matches);
  }

  // ---- Atualiza a barra de stats ----
  function updateStats() {
    if (!currentData) return;
    const activeChamps = getActiveChampions();
    const champEntries = Object.entries(activeChamps);

    // Partidas totais do período
    const matches = currentPatchOnly
      ? currentData.matches.filter(m => m.date >= getPatchStartTimestamp())
      : currentData.matches;
    const totalGames = matches.length;

    // Vitórias em 1º lugar
    const totalFirst = champEntries.reduce((a, [, v]) => a + v.firstPlaceWins, 0);

    // % de partidas que terminaram em 1º
    const firstRate = totalGames > 0 ? Math.round((totalFirst / totalGames) * 100) : 0;

    // Campeões com pelo menos um 1º lugar
    const champsWithFirst = champEntries.filter(([, v]) => v.firstPlaceWins > 0).length;

    animateCount(statGames,   0, totalGames);
    animateCount(statWins,    0, totalFirst);
    animateCount(statWinrate, 0, firstRate, '%');
    animateCount(statChamps,  0, champsWithFirst);
  }

  // ---- Busca ----
  // Timeout por quantidade de partidas
  const FETCH_TIMEOUT_MS = { 20: 25000, 40: 35000, 60: 45000, 100: 55000 };

  async function fetchMatches(gameName, tagLine, platform, count) {
    // NÃO enviamos patchStart para o servidor — a Riot API ignora count quando
    // startTime está presente e retorna apenas ~20 jogos do patch, quebrando
    // o contador de partidas e as vitórias históricas.
    // O filtro de patch é feito 100% no client via getActiveChampions().
    const params = new URLSearchParams({ gameName, tagLine, platform, count });

    // AbortController com timeout — evita loading infinito quando o servidor
    // trava, Vercel retorna 504 em HTML, ou a rede some.
    const timeoutMs = FETCH_TIMEOUT_MS[String(count)] ?? 55000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(`/api/matches?${params}`, { signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(
          `A busca demorou mais de ${Math.round(timeoutMs / 1000)}s. ` +
          `Tente reduzir a quantidade de partidas ou aguarde e tente novamente.`
        );
      }
      throw new Error('Falha de rede. Verifique sua conexão e tente novamente.');
    } finally {
      clearTimeout(timer);
    }

    let data;
    try {
      data = await res.json();
    } catch {
      // Vercel retornou HTML de erro (timeout 504 ou crash) em vez de JSON
      throw new Error(
        `Erro no servidor (${res.status}). ` +
        `Tente reduzir a quantidade de partidas ou aguarde alguns segundos.`
      );
    }

    if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
    return data;
  }

  // ---- Submit ----
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name     = inputName.value.trim();
    const tag      = inputTag.value.trim().replace('#', '');
    const platform = inputRegion.value;
    const count    = inputCount.value;

    if (!name || !tag) return shake(form);

    setLoading(true);
    hideError();
    resultsSection.classList.add('hidden');

    try {
      const data = await fetchMatches(name, tag, platform, count);
      currentData = data;
      await renderResults(data);
      resultsSection.classList.remove('hidden');
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  });

  // ---- Render Results ----
  async function renderResults(data) {
    // Player badge
    playerBadge.innerHTML = `
      <span class="badge-name">${esc(data.gameName)}</span>
      <span class="badge-tag">#${esc(data.tagLine)}</span>
      <span class="badge-region">${esc(data.platform?.toUpperCase() || 'BR1')}</span>
    `;

    // Carrega lista de campeões para o filtro de não-jogados (em paralelo)
    if (allChampionIds.length === 0) {
      getAllChampionIds().then(ids => { allChampionIds = ids; });
    }

    updateStats();
    renderGrid();
  }

  // ---- Render Grid ----
  function renderGrid() {
    if (!currentData) return;

    // ── Modo: campeões NÃO jogados ──
    if (showUnplayed) {
      renderUnplayedGrid();
      return;
    }

    // ── Modo normal ──
    const activeChamps = getActiveChampions();
    let filtered = Object.entries(activeChamps);

    if (filterText) {
      const q = filterText.toLowerCase();
      filtered = filtered.filter(([id]) => id.toLowerCase().includes(q));
    }
    if (showOnlyFirst) {
      filtered = filtered.filter(([, v]) => v.firstPlaceWins > 0);
    }

    // Sort
    if (sortBy === 'games')     filtered.sort((a, b) => b[1].games - a[1].games);
    if (sortBy === 'wins')      filtered.sort((a, b) => b[1].wins - a[1].wins);
    if (sortBy === 'winrate')   filtered.sort((a, b) => b[1].winrate - a[1].winrate);
    if (sortBy === 'placement') filtered.sort((a, b) => (a[1].avgPlacement || 9) - (b[1].avgPlacement || 9));
    if (sortBy === 'recent')    filtered.sort((a, b) => b[1].lastPlayed - a[1].lastPlayed);
    if (sortBy === 'name')      filtered.sort((a, b) => a[0].localeCompare(b[0]));

    if (filtered.length === 0) {
      const msg = showOnlyFirst
        ? 'Nenhum 1º lugar encontrado.'
        : currentPatchOnly
          ? 'Nenhuma partida encontrada neste patch.'
          : 'Nenhum campeão encontrado.';
      champGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-text">${msg}</div>
        </div>`;
      return;
    }

    champGrid.innerHTML = '';
    const frag = document.createDocumentFragment();
    filtered.forEach(([id, stats], idx) => frag.appendChild(createCard(id, stats, idx)));
    champGrid.appendChild(frag);
  }

  // ── Grid de campeões não jogados ──
  function renderUnplayedGrid() {
    const activeChamps = getActiveChampions();
    const playedIds    = new Set(Object.keys(activeChamps));

    if (allChampionIds.length === 0) {
      champGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⏳</div>
          <div class="empty-text">Carregando lista de campeões…</div>
        </div>`;
      // Tenta de novo em 500ms (aguarda a API do DDragon)
      setTimeout(() => { if (showUnplayed) renderUnplayedGrid(); }, 500);
      return;
    }

    let unplayed = allChampionIds.filter(id => !playedIds.has(id));

    if (filterText) {
      const q = filterText.toLowerCase();
      unplayed = unplayed.filter(id => id.toLowerCase().includes(q));
    }

    // Ordenação: apenas por nome faz sentido para não-jogados
    // mas respeitamos o sort-select para "A→Z" e mantemos alfa para o resto
    unplayed.sort((a, b) => a.localeCompare(b));

    if (unplayed.length === 0) {
      const msg = currentPatchOnly
        ? '🎉 Você jogou com todos os campeões neste patch!'
        : '🎉 Você jogou com todos os campeões!';
      champGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🏆</div>
          <div class="empty-text">${msg}</div>
        </div>`;
      return;
    }

    champGrid.innerHTML = '';
    const frag = document.createDocumentFragment();
    unplayed.forEach((id, idx) => frag.appendChild(createUnplayedCard(id, idx)));
    champGrid.appendChild(frag);
  }

  // ---- Card: campeão jogado ----
  function createCard(champId, stats, idx) {
    const article = document.createElement('article');
    article.className = 'champ-card';
    article.style.animationDelay = `${Math.min(idx * 30, 600)}ms`;
    if (stats.wins > 0) article.classList.add('has-wins');

    const wr   = stats.winrate;
    const avg  = stats.avgPlacement;
    const last = timeAgo(stats.lastPlayed);
    const imgSrc = DD_IMG(champId);

    article.innerHTML = `
      <div class="champ-card__glow"></div>
      <div class="champ-card__img-wrap">
        <img class="champ-card__img" src="${imgSrc}" alt="${esc(champId)}"
             loading="${idx < 8 ? 'eager' : 'lazy'}"
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><rect width=%22120%22 height=%22120%22 fill=%22%230a0a1a%22/><text x=%2250%25%22 y=%2255%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2236%22 fill=%22%23333%22>?</text></svg>'">
        <div class="champ-card__img-overlay"></div>
        <div class="champ-card__games-badge">${stats.games}x</div>
        ${stats.wins > 0 ? `<div class="champ-card__win-crown">👑</div>` : ''}
      </div>
      <div class="champ-card__body">
        <div class="champ-card__name">${esc(champId)}</div>
        <div class="champ-card__record">
          <span class="rec-w">${stats.wins}V</span>
          <span class="rec-sep">/</span>
          <span class="rec-l">${stats.losses}D</span>
          <span class="rec-wr ${wrColor(wr)}">${wr}%</span>
        </div>
        <div class="champ-card__bar-wrap">
          <div class="champ-card__bar" style="width:${wr}%" data-wr="${wr}"></div>
        </div>
        <div class="champ-card__meta">
          ${avg !== null ? `<span class="meta-placement">${placementEmoji(avg)} #${avg}</span>` : ''}
          <span class="meta-last">${last}</span>
        </div>
      </div>
    `;

    return article;
  }

  // ---- Card: campeão não jogado ----
  function createUnplayedCard(champId, idx) {
    const article = document.createElement('article');
    article.className = 'champ-card champ-card--unplayed';
    article.style.animationDelay = `${Math.min(idx * 20, 600)}ms`;

    const imgSrc = DD_IMG(champId);

    article.innerHTML = `
      <div class="champ-card__img-wrap">
        <img class="champ-card__img" src="${imgSrc}" alt="${esc(champId)}"
             loading="${idx < 8 ? 'eager' : 'lazy'}"
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><rect width=%22120%22 height=%22120%22 fill=%22%230a0a1a%22/><text x=%2250%25%22 y=%2255%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2236%22 fill=%22%23333%22>?</text></svg>'">
        <div class="champ-card__img-overlay"></div>
        <div class="champ-card__games-badge">0x</div>
        <div class="champ-card__unplayed-badge">❌</div>
      </div>
      <div class="champ-card__body">
        <div class="champ-card__name">${esc(champId)}</div>
        <div class="champ-card__record">
          <span class="rec-sep rec-unplayed">Não jogado</span>
        </div>
        <div class="champ-card__bar-wrap">
          <div class="champ-card__bar" style="width:0%" data-wr="0"></div>
        </div>
        <div class="champ-card__meta">
          <span class="meta-last">—</span>
        </div>
      </div>
    `;

    return article;
  }

  // ---- Controles de filtro/sort ----
  filterInput?.addEventListener('input', debounce(e => {
    filterText = e.target.value;
    renderGrid();
  }, 150));

  sortSelect?.addEventListener('change', e => {
    sortBy = e.target.value;
    renderGrid();
  });

  firstToggle?.addEventListener('click', () => {
    showOnlyFirst = !showOnlyFirst;
    firstToggle.classList.toggle('active', showOnlyFirst);
    firstToggle.setAttribute('aria-pressed', showOnlyFirst.toString());
    // Desativa "não jogados" ao ativar 1º lugar
    if (showOnlyFirst) {
      showUnplayed = false;
      unplayedToggle?.classList.remove('active', 'active-unplayed');
      unplayedToggle?.setAttribute('aria-pressed', 'false');
    }
    renderGrid();
  });

  unplayedToggle?.addEventListener('click', () => {
    showUnplayed = !showUnplayed;
    unplayedToggle.classList.toggle('active-unplayed', showUnplayed);
    unplayedToggle.setAttribute('aria-pressed', showUnplayed.toString());
    // Desativa "1º lugar" ao ativar "não jogados"
    if (showUnplayed) {
      showOnlyFirst = false;
      firstToggle?.classList.remove('active');
      firstToggle?.setAttribute('aria-pressed', 'false');
    }
    renderGrid();
  });

  patchToggle?.addEventListener('click', () => {
    currentPatchOnly = !currentPatchOnly;
    patchToggle.classList.toggle('active-patch', currentPatchOnly);
    patchToggle.setAttribute('aria-pressed', currentPatchOnly.toString());

    // Atualiza o label do botão com o patch atual
    patchToggle.textContent = currentPatchOnly
      ? `📅 Patch ${getPatchLabel()}`
      : '📅 Todos os patches';

    if (currentData) {
      updateStats();
      renderGrid();
    }
  });

  // ---- Helpers visuais ----
  function setLoading(on) {
    btnSearch.disabled = on;
    btnSearch.textContent = on ? 'Buscando…' : 'Buscar Partidas';
    btnSearch.classList.toggle('loading', on);
    loadingBox?.classList.toggle('hidden', !on);
  }

  function showError(msg) {
    if (!errorBox) return;
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
    errorBox.classList.add('shake');
    setTimeout(() => errorBox.classList.remove('shake'), 500);
  }

  function hideError() {
    errorBox?.classList.add('hidden');
  }

  function shake(el) {
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 500);
  }

  function animateCount(el, from, to, suffix = '') {
    if (!el) return;
    const dur   = 800;
    const start = performance.now();
    function tick(now) {
      const t   = Math.min((now - start) / dur, 1);
      const val = Math.round(from + (to - from) * easeOut(t));
      el.textContent = val + suffix;
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // ---- Init ----
  // Inicializa DDragon e, após obter a versão, atualiza o label do patch
  initDDragon().then(() => {
    if (patchToggle) {
      patchToggle.textContent = `📅 Patch ${getPatchLabel()}`;
    }
  }).catch(() => {});

  // Anima o placeholder do input
  const placeholders = ['Faker', 'Caps', 'Ruler', 'Zeus', 'Keria'];
  let phIdx = 0;
  setInterval(() => {
    phIdx = (phIdx + 1) % placeholders.length;
    inputName.placeholder = placeholders[phIdx];
  }, 2000);

})();
