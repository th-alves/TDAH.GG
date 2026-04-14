// =============================================================================
// api/leaderboard.js — Endpoint de Ranking de Amigos para o TDAH.GG
// Roda como Vercel Serverless Function
// Variável de ambiente necessária: RIOT_API_KEY
// =============================================================================

const PLATFORM_TO_REGIONAL = {
  br1:  'americas', na1:  'americas', la1:  'americas', la2:  'americas',
  euw1: 'europe',   eun1: 'europe',   tr1:  'europe',   ru:   'europe',
  kr:   'asia',     jp1:  'asia',     oc1:  'sea',       sg2:  'sea',
  ph2:  'sea',      th2:  'sea',      tw2:  'sea',       vn2:  'sea',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function riotFetch(url, apiKey, retries = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

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
    const retryAfter = Math.min(parseInt(res.headers.get('Retry-After') || '1', 10), 4);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return riotFetch(url, apiKey, retries - 1);
  }

  if (!res.ok) {
    const err = new Error(`Riot API ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// Busca os dados leves de um único jogador: campeões únicos vencidos, total partidas, winrate
async function fetchPlayerSummary(gameName, tagLine, platform, apiKey) {
  const regional = PLATFORM_TO_REGIONAL[platform.toLowerCase()] || 'americas';

  try {
    // 1. PUUID
    const account = await riotFetch(
      `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      apiKey
    );
    const { puuid } = account;

    // 2. IDs das últimas 100 partidas de Arena (queue 1700)
    const matchIds = await riotFetch(
      `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=1700&count=100`,
      apiKey
    );

    if (!matchIds.length) {
      return {
        gameName: account.gameName,
        tagLine: account.tagLine,
        platform,
        uniqueChampionsWon: 0,
        totalMatches: 0,
        wins: 0,
        winrate: 0,
        error: null,
      };
    }

    // 3. Busca detalhes das partidas em batches de 10, com delay de 200ms entre batches
    //    para respeitar o rate limit da Riot API quando múltiplos jogadores são buscados
    const BATCH_SIZE = 10;
    const allResults = [];

    for (let i = 0; i < matchIds.length; i += BATCH_SIZE) {
      const batch = matchIds.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map(id =>
          riotFetch(
            `https://${regional}.api.riotgames.com/lol/match/v5/matches/${id}`,
            apiKey
          )
        )
      );
      allResults.push(...settled);
      if (i + BATCH_SIZE < matchIds.length) {
        await new Promise(r => setTimeout(r, 80));
      }
    }

    // 4. Agrega — só o essencial
    const championsWon = new Set();
    let wins = 0;
    let totalMatches = 0;

    for (const result of allResults) {
      if (result.status !== 'fulfilled') continue;
      const match = result.value;
      const me = match.info?.participants?.find(p => p.puuid === puuid);
      if (!me) continue;

      totalMatches++;
      const won = me.win === true;
      const placement = me.placement ?? (won ? 2 : 5);

      if (placement === 1) {
        wins++;
        championsWon.add(me.championName);
      }
    }

    const winrate = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;

    return {
      gameName: account.gameName,
      tagLine: account.tagLine,
      platform,
      uniqueChampionsWon: championsWon.size,
      totalMatches,
      wins,
      winrate,
      error: null,
    };

  } catch (err) {
    const status = err.status || 500;
    const messages = {
      403: 'API inválida',
      404: 'Jogador não encontrado',
      429: 'Rate limit',
    };
    return {
      gameName,
      tagLine,
      platform,
      uniqueChampionsWon: 0,
      totalMatches: 0,
      wins: 0,
      winrate: 0,
      error: messages[status] || `Erro ${status}`,
    };
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS_HEADERS).end();
  }
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RIOT_API_KEY não configurada no servidor.' });
  }

  // Body: { players: [{ gameName, tagLine, platform }] }
  let players;
  try {
    players = req.body?.players;
  } catch {
    return res.status(400).json({ error: 'Body inválido.' });
  }

  if (!Array.isArray(players) || players.length === 0) {
    return res.status(400).json({ error: 'Lista de jogadores vazia ou inválida.' });
  }

  if (players.length > 20) {
    return res.status(400).json({ error: 'Máximo de 20 jogadores por vez.' });
  }

  // Busca jogadores com stagger de 200ms entre cada um para não estourar o rate limit
  const STAGGER_MS = 200;
  const results = [];

  await Promise.allSettled(
    players.map(async (player, idx) => {
      // Stagger: cada jogador começa com delay progressivo
      await new Promise(r => setTimeout(r, idx * STAGGER_MS));
      const summary = await fetchPlayerSummary(
        player.gameName,
        player.tagLine,
        player.platform || 'br1',
        apiKey
      );
      results[idx] = summary;
    })
  );

  // Ordena por campeões únicos vencidos (desc), depois por winrate
  const sorted = results
    .filter(Boolean)
    .sort((a, b) =>
      b.uniqueChampionsWon - a.uniqueChampionsWon ||
      b.winrate - a.winrate
    );

  return res.status(200).json({
    leaderboard: sorted,
    fetchedAt: Date.now(),
  });
}
