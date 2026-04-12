# TDAH.GG — Arena Import

Busca automaticamente o histórico de Arena do jogador via Riot API.

## Setup na Vercel

### 1. Obter a chave da Riot API

1. Acesse https://developer.riotgames.com
2. Faça login com sua conta Riot
3. Copie a **Development API Key** (válida por 24h) ou solicite uma **Production Key** para uso contínuo

### 2. Configurar variável de ambiente na Vercel

No dashboard da Vercel → seu projeto → **Settings → Environment Variables**:

```
Nome:  RIOT_API_KEY
Valor: RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Marque os ambientes: Production, Preview, Development.

### 3. Deploy

```bash
# Com Vercel CLI
vercel deploy

# Ou conecte o repositório GitHub e o deploy é automático
```

### Estrutura

```
TDAH_Riot/
├── api/
│   └── matches.js     ← Serverless function (proxy da Riot API)
├── css/
│   └── style.css
├── js/
│   ├── app.js
│   └── ddragon.js
├── index.html
├── sw.js              ← Service Worker (cache offline)
└── vercel.json        ← Headers de cache + CORS
```

### Limites da Development Key

- Expira a cada 24h (renovar manualmente em developer.riotgames.com)
- Rate limit: 20 req/s, 100 req/2min
- A função serverless agrupa as requisições em batches de 8 com pausa entre eles

### Para uso em produção

Submeta um projeto em developer.riotgames.com para obter uma **Production Key** sem expiração e com rate limits maiores.

---

> Não afiliado com a Riot Games. League of Legends é marca registrada da Riot Games.
