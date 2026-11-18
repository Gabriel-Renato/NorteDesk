# NorteDesk

MVP de **suporte remoto consentido** (fluxo semelhante ao AnyDesk): código temporário, aceite local, compartilhamento de tela via WebRTC e controle de mouse/teclado somente após autorização explícita.

## O que este repositório contém

| Caminho | Conteúdo |
|---------|----------|
| `apps/desktop` | Cliente Windows (Electron + React + TypeScript + Vite) |
| `apps/signaling` | Servidor de sinalização WebSocket (Node.js + TypeScript) |
| `packages/protocol` | Contratos, validação Zod, máquina de estados, coordenadas |
| `docs/` | Arquitetura, TURN/coturn, deploy Render, roteiro de testes |
| `render.yaml` | Blueprint de referência do Web Service (somente signaling) |

## Decisão: automação de entrada no Windows

Biblioteca escolhida: **`@nut-tree-fork/nut-js` (4.x, Apache-2.0)**.

- Bindings nativos Windows (`libnut-win32`), empacotados com `asarUnpack`.
- Eventos aplicados **somente no processo principal** do Electron.

## Requisitos

- Node.js **20.19.x** (fixado em `.node-version` / `.nvmrc` / `engines`; ambiente verificado: **20.19.5**)
- npm 10+
- Para instalador / módulo nativo: Windows 10/11 x64 + Visual Studio Build Tools
- Servidor de sinalização acessível (local ou Render)
- Para redes diferentes: **TURN próprio** — ver `docs/turn-coturn.md` (**não incluso** neste MVP)

## Configuração rápida (local)

```bash
cp .env.example .env
npm install
npm run build:protocol
```

Variáveis principais (nomes reais):

| Variável | Onde | Uso |
|----------|------|-----|
| `PORT` | Render / PaaS | Porta HTTP/WS (prioridade no servidor) |
| `SIGNALING_PORT` | Local | Porta quando `PORT` não existe (padrão `8787`) |
| `SIGNALING_HOST` | Servidor | Bind; use `0.0.0.0` |
| `VITE_SIGNALING_URL` | Cliente (build Vite) | `ws://127.0.0.1:8787` local ou `wss://…` produção |
| `STUN_URLS` | Servidor | STUN (não garante redes diferentes) |
| `TURN_URLS` / `TURN_SECRET` | Servidor | Opcional; **não configurados por padrão** |

Lista completa: `.env.example`.

## Desenvolvimento

```bash
npm run dev                 # protocolo + signaling + desktop
npm run dev:signaling       # só servidor
npm run dev:desktop         # só Electron/Vite
```

## Build e start (comandos exatos)

| Objetivo | Comando |
|----------|---------|
| Protocolo | `npm run build:protocol` |
| Signaling (protocolo + servidor) | `npm run build:signaling` |
| Iniciar signaling | `npm run start:signaling` |
| Desktop (Vite + Electron) | `npm run build -w @nortedesk/desktop` |
| Testes | `npm test` |
| Instalador Windows | `npm run rebuild:native` e `npm run dist:win` (**no Windows**) |

Health check do servidor: `GET /health` → HTTP 200 e `{"ok":true}`.

## Deploy no Render (somente signaling)

**Não** execute nem empacote o Electron no Render.

Comandos do serviço:

```text
Build:  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install && npm run build:signaling
Start:  npm run start:signaling
```

- Node: `NODE_VERSION=20.19.5`
- Health Check Path: `/health`
- O processo escuta `process.env.PORT` em `0.0.0.0`

Guia completo: [`docs/deploy-render.md`](docs/deploy-render.md).

### URL no aplicativo

1. Copie a URL pública HTTPS do Render (painel do serviço).
2. Use a forma WSS no cliente, por exemplo: se a URL for `https://SEU-SERVICO.onrender.com`, configure:

```env
VITE_SIGNALING_URL=wss://SEU-SERVICO.onrender.com
```

**Não inventamos o hostname do seu serviço.** Se ainda não tiver a URL, copie-a do painel do Render antes de gerar o instalador ou apontar o app de desenvolvimento para produção.

No plano Free, cold start é esperado: o app exibe **“Iniciando servidor, aguarde…”** e reconecta com intervalo progressivo.

## STUN / TURN

- **STUN** padrão: `stun:stun.l.google.com:19302`.
- **TURN: não está configurado** neste repositório/MVP.
- Conclusão: conexão na mesma rede tende a funcionar; **entre redes diferentes a mídia WebRTC não está garantida** sem um coturn (ou equivalente) e `TURN_URLS` + `TURN_SECRET` no servidor.

## Segurança (resumo)

- Sem captura/controle antes do aceite local.
- Queda de conexão ou reconexão do signaling **revoga controle**, libera teclas/botões e exige novo aceite/autorização.
- Produção: **WSS/HTTPS**; `contextIsolation`, sandbox, preload mínimo.

## Limitações honestas

- Sem TURN provisionado → WAN não garantida.
- Sem acesso não supervisionado, UAC, arquivos, clipboard, áudio.
- Teclado/IME parcial; processo usuário comum.
- Estado do signaling em memória (reinício do Render encerra sessões).
- Instalador Windows **não assinado**.

## Documentação adicional

- [Deploy Render](docs/deploy-render.md)
- [Arquitetura](docs/arquitetura.md)
- [TURN / coturn](docs/turn-coturn.md)
- [Roteiro de testes manuais](docs/roteiro-testes-manuais.md)
- [Limitações](docs/limitacoes.md)
