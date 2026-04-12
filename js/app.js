// =============================================================================
// app.js — TDAH.GG Riot Import
// =============================================================================

(function () {
  'use strict';

  // ---- Estado ----
  let currentData   = null;
  let sortBy        = 'games';
  let filterText    = '';
  let showOnlyWon   = false;

  // ---- DOM ----
  const form         = document.getElementById('search-form');
  const inputName    = document.getElementById('input-name');
  const inputTag     = document.getElementById('input-tag');
  const inputRegion  = document.getElementById('input-region');
  const inputCount   = document.getElementById('input-count');
  const btnSearch    = document.getElementById('btn-search');
  const heroSection  = document.getElementById('hero');
  const resultsSection = document.getElementById('results');
  const champGrid    = document.getElementById('champ-grid');
  const filterInput  = document.getElementById('filter-input');
  const sortSelect   = document.getElementById('sort-select');
  const wonToggle    = document.getElementById('won-toggle');
  const statGames    = document.getElementById('stat-games');
  const statWins     = document.getElementById('stat-wins');
  const statWinrate  = document.getElementById('stat-winrate');
  const statChamps   = document.getElementById('stat-champs');
  const playerBadge  = document.getElementById('player-badge');
  const errorBox     = document.getElementById('error-box');
  const loadingBox   = document.getElementById('loading-box');

  // ---- Utilitários ----
  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
    if (d < 30) return `${Math.floor(d/7)}sem atrás`;
    if (d < 365) return `${Math.floor(d/30)}meses atrás`;
    return `${Math.floor(d/365)}a atrás`;
  }

  // ---- Busca ----
  async function fetchMatches(gameName, tagLine, platform, count) {
    const params = new URLSearchParams({ gameName, tagLine, platform, count });
    const res = await fetch(`/api/matches?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
    return data;
  }

  // ---- Submit ----
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name    = inputName.value.trim();
    const tag     = inputTag.value.trim().replace('#', '');
    const platform = inputRegion.value;
    const count   = inputCount.value;

    if (!name || !tag) return shake(form);

    setLoading(true);
    hideError();
    resultsSection.classList.add('hidden');

    try {
      const data = await fetchMatches(name, tag, platform, count);
      currentData = data;
      renderResults(data);
      resultsSection.classList.remove('hidden');
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  });

  // ---- Render Results ----
  function renderResults(data) {
    // Player badge
    playerBadge.innerHTML = `
      <span class="badge-name">${esc(data.gameName)}</span>
      <span class="badge-tag">#${esc(data.tagLine)}</span>
      <span class="badge-region">${esc(data.platform?.toUpperCase() || 'BR1')}</span>
    `;

    // Stats
    const champs = Object.entries(data.champions);
    const totalGames  = data.totalGames;
    const totalWins   = champs.reduce((a, [, v]) => a + v.wins, 0);
    const totalWinrate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;

    animateCount(statGames,   0, totalGames);
    animateCount(statWins,    0, totalWins);
    animateCount(statWinrate, 0, totalWinrate, '%');
    animateCount(statChamps,  0, champs.length);

    renderGrid();
  }

  function renderGrid() {
    if (!currentData) return;
    const champs = Object.entries(currentData.champions);
    let filtered = champs;

    if (filterText) {
      const q = filterText.toLowerCase();
      filtered = filtered.filter(([id]) => id.toLowerCase().includes(q));
    }
    if (showOnlyWon) {
      filtered = filtered.filter(([, v]) => v.wins > 0);
    }

    // Sort
    if (sortBy === 'games')    filtered.sort((a, b) => b[1].games - a[1].games);
    if (sortBy === 'wins')     filtered.sort((a, b) => b[1].wins - a[1].wins);
    if (sortBy === 'winrate')  filtered.sort((a, b) => b[1].winrate - a[1].winrate);
    if (sortBy === 'placement') filtered.sort((a, b) => (a[1].avgPlacement||9) - (b[1].avgPlacement||9));
    if (sortBy === 'recent')   filtered.sort((a, b) => b[1].lastPlayed - a[1].lastPlayed);
    if (sortBy === 'name')     filtered.sort((a, b) => a[0].localeCompare(b[0]));

    if (filtered.length === 0) {
      champGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-text">${showOnlyWon ? 'Nenhuma vitória encontrada.' : 'Nenhum campeão encontrado.'}</div>
        </div>`;
      return;
    }

    champGrid.innerHTML = '';
    const frag = document.createDocumentFragment();
    filtered.forEach(([id, stats], idx) => {
      frag.appendChild(createCard(id, stats, idx));
    });
    champGrid.appendChild(frag);
  }

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

  // ---- Controles de filtro/sort ----
  filterInput?.addEventListener('input', debounce(e => {
    filterText = e.target.value;
    renderGrid();
  }, 150));

  sortSelect?.addEventListener('change', e => {
    sortBy = e.target.value;
    renderGrid();
  });

  wonToggle?.addEventListener('click', () => {
    showOnlyWon = !showOnlyWon;
    wonToggle.classList.toggle('active', showOnlyWon);
    wonToggle.setAttribute('aria-pressed', showOnlyWon.toString());
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
  initDDragon();

  // Anima o placeholder do input
  const placeholders = ['Faker', 'Caps', 'Ruler', 'Zeus', 'Keria'];
  let phIdx = 0;
  setInterval(() => {
    phIdx = (phIdx + 1) % placeholders.length;
    inputName.placeholder = placeholders[phIdx];
  }, 2000);

})();
