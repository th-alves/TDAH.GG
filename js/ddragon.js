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

// Calcula o timestamp de início do SPLIT atual baseado na versão do DDragon.
// Formato da versão: "YY.P.x" ex: "26.7.1"
// Regra de mapeamento de versão para ano real:
//   versão < 20  → ano = versão + 2010  (ex: 14 → 2024)
//   versão >= 20 → ano = versão + 2000  (ex: 26 → 2026)
//
// Estrutura de splits por ano (cada split ≈ 8 patches de ~14 dias):
//   Split 1: patches 1–8   → começa ~08 de janeiro
//   Split 2: patches 9–16  → começa ~08 de janeiro + 112 dias (~01 de maio)
//   Split 3: patches 17+   → começa ~08 de janeiro + 224 dias (~19 de agosto)
//
// Isso alinha com a "Jornada da Temporada" do jogo, que conta campeões
// desde o início do split atual — não do patch atual.
function getPatchStartTimestamp() {
  try {
    const parts    = DD_VERSION.split('.');
    const major    = parseInt(parts[0], 10);
    const patchNum = parseInt(parts[1], 10);
    const year     = major < 20 ? major + 2010 : major + 2000;

    // 8 de janeiro é o início aproximado do Split 1 de cada ano
    const seasonStart = new Date(year, 0, 8); // mês 0 = janeiro

    // Determina o patch de início do split atual.
    // Cada split cobre ~8 patches (8 × 14 dias ≈ 16 semanas ≈ 4 meses).
    let splitStartPatch;
    if (patchNum <= 8) {
      splitStartPatch = 1;   // Split 1: patches 1–8
    } else if (patchNum <= 16) {
      splitStartPatch = 9;   // Split 2: patches 9–16
    } else {
      splitStartPatch = 17;  // Split 3: patches 17+
    }

    const splitStart = new Date(
      seasonStart.getTime() + (splitStartPatch - 1) * 14 * 24 * 60 * 60 * 1000
    );
    return splitStart.getTime();
  } catch {
    // Fallback: 120 dias atrás (≈ 1 split completo)
    return Date.now() - 120 * 24 * 60 * 60 * 1000;
  }
}

// Retorna o timestamp de início do PATCH atual (não do split inteiro).
// Útil para replicar o comportamento padrão do op.gg (últimas ~2 semanas).
function getCurrentPatchTimestamp() {
  try {
    const parts    = DD_VERSION.split('.');
    const major    = parseInt(parts[0], 10);
    const patchNum = parseInt(parts[1], 10);
    const year     = major < 20 ? major + 2010 : major + 2000;

    // Início da temporada (8 de janeiro) + (patchNum - 1) × 14 dias
    const seasonStart = new Date(year, 0, 8);
    return seasonStart.getTime() + (patchNum - 1) * 14 * 24 * 60 * 60 * 1000;
  } catch {
    // Fallback: 14 dias atrás (≈ 1 patch)
    return Date.now() - 14 * 24 * 60 * 60 * 1000;
  }
}

// Retorna o número do split atual: 1, 2 ou 3
function getCurrentSplitNumber() {
  try {
    const patchNum = parseInt(DD_VERSION.split('.')[1], 10);
    if (patchNum <= 8)  return 1;
    if (patchNum <= 16) return 2;
    return 3;
  } catch {
    return 1;
  }
}

// Retorna o label do split atual, ex: "Split 1 · 26.7"
function getPatchLabel() {
  const parts = DD_VERSION.split('.');
  const versionLabel = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : DD_VERSION;
  return `Split ${getCurrentSplitNumber()} · ${versionLabel}`;
}
