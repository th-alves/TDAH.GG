// =============================================================================
// api/matches.js — Proxy da Riot API para o TDAH.GG
// Roda como Vercel Serverless Function
// Variável de ambiente necessária: RIOT_API_KEY
// =============================================================================

const PLATFORM_TO_REGIONAL = {
  br1:  'americas',
  na1:  'americas',
  la1:  'americas',
  la2:  'americas',
  euw1: 'europe',
  eun1: 'europe',
  tr1:  'europe',
  ru:   'europe',
  kr:   'asia',
  jp1:  'asia',
  oc1:  'sea',
  sg2:  'sea',
  ph2:  'sea',
  th2:  'sea',
  tw2:  'sea',
  vn2:  'sea',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Fetch com retry automático em 429 (rate limit) e timeout de 8s por request
async function riotFetch(url, apiKey, retries = 2) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000); // 8s por request

  let res;
  try {
    res = await fetch(url, {
      headers: { 'X-Riot-Token': apiKey },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`Riot API timeout: ${url}`);
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429 && retries > 0) {
    // Limita o Retry-After a no máximo 5s para não estourar o timeout do Vercel
    const retryAfter = Math.min(parseInt(res.headers.get('Retry-After') || '1', 10), 5);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return riotFetch(url, apiKey, retries - 1);
  }

  if (!res.ok) {
    const err = new Error(`Riot API ${res.status}: ${url}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// Busca em paralelo com limite de concorrência — batch maior e delay menor para caber no timeout
async function fetchInBatches(urls, apiKey, batchSize = 12) {
  const results = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map(url => riotFetch(url, apiKey))
    );
    results.push(...settled);
    if (i + batchSize < urls.length) {
      await new Promise(r => setTimeout(r, 50)); // 50ms entre batches (era 120ms)
    }
  }
  return results;
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS_HEADERS).end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RIOT_API_KEY não configurada no servidor.' });
  }

  const { gameName, tagLine, platform = 'br1', count = '100' } = req.query;

  if (!gameName || !tagLine) {
    return res.status(400).json({ error: 'Parâmetros gameName e tagLine são obrigatórios.' });
  }

  const regional   = PLATFORM_TO_REGIONAL[platform.toLowerCase()] || 'americas';
  const matchCount = Math.min(Math.max(parseInt(count, 10) || 100, 1), 100);

  // startTime removido: a Riot API ignora o count quando startTime está presente,
  // retornando apenas ~20 jogos do patch. O filtro de patch é client-side.
  const startTimeParam = '';

  try {
    // 1. PUUID via Riot ID
    const account = await riotFetch(
      `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      apiKey
    );
    const { puuid } = account;

    // 2. IDs das partidas de Arena (queue 1700)
    // Com startTime → retorna apenas matches do patch atual (~15-25), bem mais rápido
    const matchIds = await riotFetch(
      `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=1700&count=${matchCount}${startTimeParam}`,
      apiKey
    );

    if (!matchIds.length) {
      return res.status(200).json({
        gameName: account.gameName,
        tagLine:  account.tagLine,
        puuid,
        matches:  [],
        champions: {},
        totalGames: 0,
      });
    }

    // 3. Detalhes de cada partida em paralelo (batches de 8)
    const matchUrls = matchIds.map(id =>
      `https://${regional}.api.riotgames.com/lol/match/v5/matches/${id}`
    );
    const settled = await fetchInBatches(matchUrls, apiKey);

    // 4. Agrega por campeão
    const champStats = {};
    const matchSummaries = [];

    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      const match = result.value;
      const info  = match.info;

      // Encontra o participante do usuário
      const me = info.participants.find(p => p.puuid === puuid);
      if (!me) continue;

      const champId   = me.championName;
      const won = me.win === true;
      // me.placement é sempre enviado pela Riot API no Arena, mas se vier
      // indefinido, NÃO assumimos 1º lugar — win=true no Arena significa top 2.
      // Usamos 2 como fallback conservador para não inflar contagem de 1º lugar.
      if (me.placement === undefined || me.placement === null) {
        console.warn(`[TDAH] placement ausente — matchId:${match.metadata.matchId} champ:${me.championName} win:${won}`);
      }
      const placement = me.placement ?? (won ? 2 : 4); // Arena: máximo é 4, nunca 5
      const gameDate  = info.gameStartTimestamp;
      const duration  = info.gameDuration; // segundos

      if (!champStats[champId]) {
        champStats[champId] = { wins: 0, losses: 0, placements: [], lastPlayed: 0 };
      }
      if (won) champStats[champId].wins++;
      else     champStats[champId].losses++;
      champStats[champId].placements.push(placement);
      if (gameDate > champStats[champId].lastPlayed) {
        champStats[champId].lastPlayed = gameDate;
      }

      matchSummaries.push({
        matchId:   match.metadata.matchId,
        champion:  champId,
        win:       won,
        placement,
        duration,
        date:      gameDate,
      });
    }

    // Calcula médias de placement
    for (const [, stats] of Object.entries(champStats)) {
      stats.avgPlacement = stats.placements.length
        ? +(stats.placements.reduce((a, b) => a + b, 0) / stats.placements.length).toFixed(1)
        : null;
      stats.games = stats.wins + stats.losses;
      stats.winrate = stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0;
    }

    return res.status(200).json({
      gameName:   account.gameName,
      tagLine:    account.tagLine,
      puuid,
      platform,
      champions:  champStats,
      matches:    matchSummaries.sort((a, b) => b.date - a.date),
      totalGames: matchSummaries.length,
      fetchedAt:  Date.now(),
    });

  } catch (err) {
    console.error('Riot API error:', err.message);
    const status = err.status || 500;
    const messages = {
      400: 'Riot ID inválido.',
      403: 'Chave de API inválida ou expirada.',
      404: 'Jogador não encontrado. Verifique o Riot ID e a região.',
      429: 'Muitas requisições. Aguarde alguns segundos e tente de novo.',
    };
    return res.status(status).json({
      error: messages[status] || `Erro ao buscar dados da Riot (${status}).`,
    });
  }
}
