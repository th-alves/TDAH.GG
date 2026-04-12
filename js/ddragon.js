// =============================================================================
// ddragon.js — Data Dragon CDN helpers
// =============================================================================

let DD_VERSION = '16.7.1';

const DD_IMG     = id => `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/champion/${id}.png`;
const DD_SPLASH  = id => `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${id}_0.jpg`;
const DD_LOADING = id => `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${id}_0.jpg`;

const CACHE_KEY = 'tdahriot_dd_version';

async function initDDragon() {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) { DD_VERSION = cached; return; }
    const res  = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const vers = await res.json();
    if (vers && vers[0]) {
      DD_VERSION = vers[0];
      sessionStorage.setItem(CACHE_KEY, DD_VERSION);
    }
  } catch { /* usa fallback */ }
}
