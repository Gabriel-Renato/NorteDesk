# Deploy do signaling no Render

O Web Service no Render deve executar **somente** o servidor de sinalização (`apps/signaling` + `packages/protocol`). O cliente Electron **não** é empacotado nem iniciado no Linux do Render.

## Comandos exatos deste repositório

| Etapa | Comando |
|-------|---------|
| Build | `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install && npm run build:signaling` |
| Start | `npm run start:signaling` |
| Health | `GET /health` → `{"ok":true}` |

Equivalente expandido do build:

```bash
npm run build -w @nortedesk/protocol && npm run build -w @nortedesk/signaling
```

Start expandido:

```bash
npm run start -w @nortedesk/signaling
```

(que executa `node dist/index.js` dentro de `apps/signaling`.)

## Node.js

Versão fixada: **20.19.5** (via `.node-version`, `.nvmrc` e `engines.node: 20.19.x`).

No Render, defina também `NODE_VERSION=20.19.5` (já previsto em `render.yaml`).

## Porta e bind

O processo escuta em `0.0.0.0` e usa `process.env.PORT` quando presente (Render injeta `PORT`). Localmente, sem `PORT`, usa `SIGNALING_PORT` (padrão `8787`).

## Variáveis no painel do Render

Obrigatórias / recomendadas:

| Variável | Valor sugerido |
|----------|----------------|
| `NODE_VERSION` | `20.19.5` |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1` |
| `SIGNALING_HOST` | `0.0.0.0` |
| `STUN_URLS` | `stun:stun.l.google.com:19302` |
| `CODE_TTL_MS` | `600000` |
| `HEARTBEAT_INTERVAL_MS` | `15000` |
| `HEARTBEAT_TIMEOUT_MS` | `45000` |

`PORT` é definido pelo Render — **não** fixe `SIGNALING_PORT` no serviço como substituto de `PORT`.

### TURN

**Não há TURN provisionado neste MVP.** Sem `TURN_URLS` + `TURN_SECRET`, a conexão WebRTC entre redes diferentes **não está garantida**. STUN sozinho não basta em muitos NATs.

## URL pública → cliente Electron

1. No Render, copie a URL HTTPS do serviço (ex.: `https://xxxx.onrender.com`).
2. Converta para WebSocket seguro: `wss://xxxx.onrender.com`.
3. No `.env` local (antes de `npm run dist:win` ou `npm run dev:desktop` apontando para produção):

```env
VITE_SIGNALING_URL=wss://xxxx.onrender.com
```

Não invente o hostname: use exatamente o exibido no painel.

## Plano Free / cold start

No plano gratuito o serviço pode “dormir”. O cliente mostra **“Iniciando servidor, aguarde…”** e reconecta com intervalo progressivo até o WebSocket responder.
