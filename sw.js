// =============================================================================
// ddragon.js — Data Dragon CDN helpers
// =============================================================================

let DD_VERSION = '16.7.1';

const DD_IMG     = id => `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/champion/${id}.png`;
const DD_SPLASH  = id => `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${id}_0.jpg`;
const DD_LOADING = id => `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${id}_0.jpg`;

const CACHE_KEY       = 'tdahriot_dd_version';
const CHAMP_CACHE_KEY = 'tdahriot_champ_list';

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

// Retorna todos os IDs de campeões disponíveis no DDragon (ex: "Aatrox", "Ahri"…)
async function getAllChampionIds() {
  try {
    // Invalida cache se versão mudou
    const cachedVersion = sessionStorage.getItem(CACHE_KEY);
    const cacheKey = `${CHAMP_CACHE_KEY}_${cachedVersion || DD_VERSION}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);

    const res  = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/data/pt_BR/champion.json`
    );
    const data = await res.json();
    const ids  = Object.keys(data.data).sort((a, b) => a.localeCompare(b));
    sessionStorage.setItem(cacheKey, JSON.stringify(ids));
    return ids;
  } catch {
    return [];
  }
}

// Calcula o timestamp de início do patch atual baseado na versão do DDragon.
// Formato da versão: "YY.P.x" ex: "26.7.1"
// Regra de mapeamento de versão para ano real:
//   versão < 20  → ano = versão + 2010  (ex: 14 → 2024)
//   versão >= 20 → ano = versão + 2000  (ex: 26 → 2026)
// Temporada começa ~8 de janeiro; cada patch dura ~14 dias.
function getPatchStartTimestamp() {
  try {
    const parts    = DD_VERSION.split('.');
    const major    = parseInt(parts[0], 10);
    const patchNum = parseInt(parts[1], 10);
    const year     = major < 20 ? major + 2010 : major + 2000;

    // 8 de janeiro é o início aproximado da Season 1 de cada ano
    const seasonStart = new Date(year, 0, 8); // mês 0 = janeiro
    const patchStart  = new Date(
      seasonStart.getTime() + (patchNum - 1) * 14 * 24 * 60 * 60 * 1000
    );
    return patchStart.getTime();
  } catch {
    // Fallback: 14 dias atrás
    return Date.now() - 14 * 24 * 60 * 60 * 1000;
  }
}

// Retorna o patch formatado, ex: "26.7"
function getPatchLabel() {
  const parts = DD_VERSION.split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : DD_VERSION;
}
