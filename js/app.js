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
    const agora   = new Date();
    const jogado  = new Date(ts);
    // Zera as horas para comparar apenas o dia do calendário (ignora hora/minuto/segundo)
    const diaAgora  = new Date(agora.getFullYear(),  agora.getMonth(),  agora.getDate());
    const diaJogado = new Date(jogado.getFullYear(), jogado.getMonth(), jogado.getDate());
    const d = Math.round((diaAgora - diaJogado) / 86400000);
    if (d === 0)   return 'hoje';
    if (d === 1)   return 'ontem';
    if (d < 7)     return `${d}d atrás`;
    if (d < 30)    return `${Math.floor(d / 7)}sem atrás`;
    if (d < 365)   return `${Math.floor(d / 30)}meses atrás`;
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
    const matches = currentData.matches.filter(m => m.date >= getPatchStartTimestamp());
    return computeChampStats(matches);
  }

  // ---- Atualiza a barra de stats ----
  function updateStats() {
    if (!currentData) return;
    const activeChamps = getActiveChampions();
    const champEntries = Object.entries(activeChamps);

    // Partidas totais do período
    const matches = currentData.matches.filter(m => m.date >= getPatchStartTimestamp());
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
        ? 'Nenhum 1º lugar encontrado no split atual.'
        : 'Nenhuma partida encontrada no split atual.';
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
      const msg = '🎉 Você jogou com todos os campeões no split atual!';
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
  // Inicializa DDragon
  initDDragon().catch(() => {});

  // Anima o placeholder do input
  const placeholders = ['Thigas, O Grande', 'Qwsae, O Baixo', 'Naty, Teacher of English', 'Xin, A Casada', 'Max, O Mamador', 'Yago, Goza e Some'];
  let phIdx = 0;
  setInterval(() => {
    phIdx = (phIdx + 1) % placeholders.length;
    inputName.placeholder = placeholders[phIdx];
  }, 2000);

  // ==========================================================================
  // RANKING DE AMIGOS
  // ==========================================================================

  const RANKING_LS_FRIENDS = 'tdah_ranking_friends';
  const RANKING_LS_CACHE   = 'tdah_ranking_cache';
  const RANKING_CACHE_TTL  = 10 * 60 * 1000; // 10 minutos em ms

  // ---- Elementos do ranking ----
  const rankingBtn    = document.getElementById('ranking-btn');
  const rankingDropdown = document.getElementById('ranking-dropdown');
  const rdGearBtn     = document.getElementById('rd-gear-btn');
  const rdManage      = document.getElementById('rd-manage');
  const rdAddInput    = document.getElementById('rd-add-input');
  const rdAddRegion   = document.getElementById('rd-add-region');
  const rdAddBtn      = document.getElementById('rd-add-btn');
  const rdFriendList  = document.getElementById('rd-friend-list');
  const rdBody        = document.getElementById('rd-body');
  const rdFooter      = document.getElementById('rd-footer');
  const rdSearchBtn   = document.getElementById('rd-search-btn');

  // ---- Estado do ranking ----
  let rankingOpen     = false;
  let manageOpen      = false;
  let rankingFetching = false;

  // ---- Amigos padrão (aparecem pra todo mundo na primeira visita) ----
  const DEFAULT_FRIENDS = [
    { gameName: 'TDAH Thigas シ', tagLine: 'lulu',  platform: 'br1', isDefault: true },
    { gameName: 'Nuke De Kat',       tagLine: 'NDK',   platform: 'br1', isDefault: true },
    { gameName: 'TDAH QwSaE',        tagLine: 'AGUA',  platform: 'br1', isDefault: true },
    { gameName: 'TDAH OnlyEmotes',   tagLine: 'TDHA',  platform: 'br1', isDefault: true },
  ];

  // ---- Persistência de amigos ----
  function loadFriends() {
    try {
      const raw = localStorage.getItem(RANKING_LS_FRIENDS);
      // Primeira visita: injeta os defaults e salva
      if (raw === null) {
        saveFriends(DEFAULT_FRIENDS);
        return DEFAULT_FRIENDS;
      }
      return JSON.parse(raw);
    } catch { return DEFAULT_FRIENDS; }
  }
  function saveFriends(list) {
    localStorage.setItem(RANKING_LS_FRIENDS, JSON.stringify(list));
  }

  // ---- Cache de ranking ----
  function loadRankingCache() {
    try {
      const raw = localStorage.getItem(RANKING_LS_CACHE);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || Date.now() - obj.fetchedAt > RANKING_CACHE_TTL) return null;
      return obj;
    } catch { return null; }
  }
  function saveRankingCache(data) {
    localStorage.setItem(RANKING_LS_CACHE, JSON.stringify(data));
  }
  function clearRankingCache() {
    localStorage.removeItem(RANKING_LS_CACHE);
  }

  // ---- Toggle dropdown ----
  rankingBtn?.addEventListener('click', e => {
    e.stopPropagation();
    rankingOpen = !rankingOpen;
    rankingBtn.setAttribute('aria-expanded', rankingOpen.toString());
    rankingBtn.classList.toggle('is-open', rankingOpen);
    rankingDropdown.hidden = !rankingOpen;
    if (rankingOpen) {
      renderFriendFooter();
      renderRankingBody();
    }
  });

  // Fechar ao clicar fora
  document.addEventListener('click', e => {
    if (rankingOpen && !rankingDropdown.contains(e.target) && e.target !== rankingBtn) {
      closeRankingDropdown();
    }
  });

  // Fechar com ESC
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && rankingOpen) closeRankingDropdown();
  });

  function closeRankingDropdown() {
    rankingOpen = false;
    rankingBtn?.setAttribute('aria-expanded', 'false');
    rankingBtn?.classList.remove('is-open');
    if (rankingDropdown) rankingDropdown.hidden = true;
  }

  // ---- Toggle painel de gerenciar amigos ----
  rdGearBtn?.addEventListener('click', e => {
    e.stopPropagation();
    manageOpen = !manageOpen;
    rdGearBtn.classList.toggle('is-active', manageOpen);
    if (rdManage) rdManage.hidden = !manageOpen;
    if (manageOpen) {
      renderFriendListUI();
      rdAddInput?.focus();
    }
  });

  // ---- Adicionar amigo ----
  function addFriendFromInput() {
    const raw = rdAddInput?.value.trim();
    if (!raw) { shake(rdAddInput); return; }
    const region = rdAddRegion?.value || 'br1';

    // Aceita "Nome#TAG" ou "Nome TAG" ou só "Nome" (sem tag)
    let gameName, tagLine;
    if (raw.includes('#')) {
      [gameName, tagLine] = raw.split('#').map(s => s.trim());
    } else {
      gameName = raw;
      tagLine = '';
    }
    if (!gameName) return shake(rdAddInput);

    const friends = loadFriends();
    const alreadyExists = friends.some(f =>
      f.gameName.toLowerCase() === gameName.toLowerCase() &&
      f.tagLine.toLowerCase() === (tagLine || '').toLowerCase() &&
      f.platform === region
    );
    if (alreadyExists) {
      rdAddInput.classList.add('shake');
      setTimeout(() => rdAddInput.classList.remove('shake'), 400);
      return;
    }

    friends.push({ gameName, tagLine: tagLine || '', platform: region });
    saveFriends(friends);
    rdAddInput.value = '';
    renderFriendListUI();
    renderFriendFooter();
    clearRankingCache();
    renderRankingBody(); // volta ao estado idle para mostrar "busque ranking"
  }

  rdAddBtn?.addEventListener('click', e => { e.stopPropagation(); addFriendFromInput(); });
  rdAddInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFriendFromInput(); } });

  // ---- Renderiza lista de amigos no painel de gerenciar ----
  function renderFriendListUI() {
    if (!rdFriendList) return;
    const friends = loadFriends();
    if (friends.length === 0) {
      rdFriendList.innerHTML = '';
      return;
    }
    rdFriendList.innerHTML = friends.map((f, i) => `
      <li class="rd__friend-item${f.isDefault ? ' rd__friend-item--default' : ''}" data-idx="${i}">
        <span>
          <span class="rd__friend-name">${esc(f.gameName)}</span>
          <span class="rd__friend-tag">${f.tagLine ? '#' + esc(f.tagLine) : ''}</span>
          <span class="rd__friend-region">${esc(f.platform.toUpperCase())}</span>
          ${f.isDefault ? '<span class="rd__friend-default-badge">padrão</span>' : ''}
        </span>
        <button class="rd__friend-remove" data-idx="${i}" aria-label="Remover ${esc(f.gameName)}">×</button>
      </li>
    `).join('');

    rdFriendList.querySelectorAll('.rd__friend-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        const friends2 = loadFriends();
        friends2.splice(idx, 1);
        saveFriends(friends2);
        clearRankingCache();
        renderFriendListUI();
        renderFriendFooter();
        renderRankingBody();
      });
    });
  }

  // ---- Mostra/esconde footer (botão buscar) ----
  function renderFriendFooter() {
    if (!rdFooter) return;
    const friends = loadFriends();
    rdFooter.hidden = friends.length === 0;
  }

  // ---- Renderiza o corpo do dropdown (ranking ou idle) ----
  function renderRankingBody() {
    if (!rdBody) return;
    const friends = loadFriends();

    if (friends.length === 0) {
      rdBody.innerHTML = `
        <div class="rd__empty">
          <div class="rd__empty-icon">👥</div>
          <div class="rd__empty-text">Adicione amigos clicando na ⚙️</div>
        </div>`;
      return;
    }

    // Tenta carregar do cache
    const cached = loadRankingCache();
    if (cached) {
      renderLeaderboardRows(cached.leaderboard, cached.fetchedAt);
      return;
    }

    // Nenhum cache — mostra prompt para buscar
    rdBody.innerHTML = `
      <div class="rd__empty">
        <div class="rd__empty-icon">🏆</div>
        <div class="rd__empty-text">${friends.length} amigo${friends.length > 1 ? 's' : ''} na lista.<br>Clique em <strong>Buscar ranking</strong>!</div>
      </div>`;
  }

  // ---- Renderiza as linhas do leaderboard ----
  function renderLeaderboardRows(leaderboard, fetchedAt) {
    if (!rdBody) return;

    const rankClass = ['rd__rank--gold', 'rd__rank--silver', 'rd__rank--bronze'];
    const rankEmoji = ['🥇', '🥈', '🥉'];

    const rowsHtml = leaderboard.map((player, idx) => {
      if (player.error) {
        return `
          <div class="rd__row has-error" aria-disabled="true">
            <div class="rd__rank">${idx + 1}</div>
            <div class="rd__player">
              <div class="rd__player-name">${esc(player.gameName)}</div>
              <div class="rd__player-error">${esc(player.error)}</div>
            </div>
            <div class="rd__stats">
              <div class="rd__champs">—</div>
            </div>
          </div>`;
      }

      const wrClass = player.winrate >= 60 ? 'wr-high' : player.winrate >= 50 ? 'wr-mid' : '';
      const rankLabel = idx < 3 ? rankEmoji[idx] : String(idx + 1);
      const rankCls   = idx < 3 ? rankClass[idx] : '';
      const tagDisplay = player.tagLine ? `#${esc(player.tagLine)}` : '';

      return `
        <div class="rd__row" role="button" tabindex="0"
             data-name="${esc(player.gameName)}"
             data-tag="${esc(player.tagLine)}"
             data-platform="${esc(player.platform)}"
             aria-label="Ver detalhes de ${esc(player.gameName)}">
          <div class="rd__rank ${rankCls}">${rankLabel}</div>
          <div class="rd__player">
            <div class="rd__player-name">${esc(player.gameName)}</div>
            <div class="rd__player-tag">${tagDisplay} · ${esc(player.platform.toUpperCase().replace(/\d+$/, ''))}</div>
          </div>
          <div class="rd__stats">
            <div class="rd__champs">${player.uniqueChampionsWon} <span>únicos</span></div>
            <div class="rd__winrate ${wrClass}">${player.totalMatches}p · ${player.winrate}%</div>
          </div>
        </div>`;
    }).join('');

    // Calcula tempo restante no cache
    const msLeft = RANKING_CACHE_TTL - (Date.now() - fetchedAt);
    const minLeft = Math.max(0, Math.ceil(msLeft / 60000));
    const cacheText = minLeft > 0
      ? `Cache: ${minLeft}min restante${minLeft > 1 ? 's' : ''}`
      : 'Cache expirado';

    rdBody.innerHTML = `
      <div class="rd__table">${rowsHtml}</div>
      <div class="rd__cache-bar">
        <span>${cacheText}</span>
        <button class="rd__cache-refresh" id="rd-cache-refresh">↺ Atualizar</button>
      </div>`;

    // Evento de refresh de cache
    rdBody.querySelector('#rd-cache-refresh')?.addEventListener('click', e => {
      e.stopPropagation();
      clearRankingCache();
      fetchRanking();
    });

    // Clique nas linhas → preenche formulário e busca
    rdBody.querySelectorAll('.rd__row[data-name]').forEach(row => {
      const handleSelect = () => {
        const name     = row.dataset.name;
        const tag      = row.dataset.tag;
        const platform = row.dataset.platform;

        // Preenche o formulário principal
        if (inputName) inputName.value = name;
        if (inputTag)  inputTag.value  = tag;
        // Garante que a opção existe no select antes de setar;
        // se não existir (ex: região não-BR num select de região única), cria dinamicamente
        if (inputRegion) {
          let opt = inputRegion.querySelector(`option[value="${platform}"]`);
          if (!opt) {
            opt = document.createElement('option');
            opt.value = platform;
            opt.textContent = platform.toUpperCase().replace(/\d+$/, '');
            inputRegion.appendChild(opt);
          }
          inputRegion.value = platform;
        }

        // Fecha dropdown
        closeRankingDropdown();

        // Rola suavemente até o hero e dispara a busca
        heroSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => form?.requestSubmit(), 350);
      };

      row.addEventListener('click', handleSelect);
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(); }
      });
    });
  }

  // ---- Buscar ranking via API ----
  async function fetchRanking() {
    if (rankingFetching) return;
    const friends = loadFriends();
    if (friends.length === 0) return;

    rankingFetching = true;
    rdSearchBtn.disabled = true;
    rdSearchBtn.classList.add('loading');
    rdSearchBtn.textContent = 'Buscando…';

    // Mostra loading skeleton
    rdBody.innerHTML = `
      <div class="rd__loading">
        ${friends.map(() => '<div class="rd__loading-row"></div>').join('')}
      </div>`;

    try {
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: friends }),
      });

      let data;
      try { data = await res.json(); }
      catch { throw new Error('Resposta inválida do servidor.'); }

      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);

      saveRankingCache(data);
      renderLeaderboardRows(data.leaderboard, data.fetchedAt);

    } catch (err) {
      rdBody.innerHTML = `
        <div class="rd__empty">
          <div class="rd__empty-icon">⚠️</div>
          <div class="rd__empty-text">${esc(err.message)}</div>
        </div>`;
    } finally {
      rankingFetching = false;
      if (rdSearchBtn) {
        rdSearchBtn.disabled = false;
        rdSearchBtn.classList.remove('loading');
        rdSearchBtn.innerHTML = `
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
            <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/>
          </svg>
          Buscar ranking`;
      }
    }
  }

  rdSearchBtn?.addEventListener('click', e => { e.stopPropagation(); fetchRanking(); });

})();

