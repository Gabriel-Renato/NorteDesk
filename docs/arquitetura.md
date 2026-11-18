# Arquitetura do NorteDesk (MVP)

## Visão geral

```
┌──────────────────┐     WebSocket      ┌────────────────────┐
│  App Electron    │◄──────────────────►│  Sinalização       │
│  (Host)          │   códigos/SDP/ICE  │  (Node.js)         │
└────────┬─────────┘                    └─────────▲──────────┘
         │ WebRTC (vídeo + DataChannel)           │
         └────────────────────────────────────────┤
                                                  │
┌──────────────────┐                              │
│  App Electron    │◄─────────────────────────────┘
│  (Atendente)     │
└──────────────────┘
```

## Componentes

| Pacote | Função |
|--------|--------|
| `packages/protocol` | Contratos Zod, máquina de estados, coordenadas, rate-limit |
| `apps/signaling` | Códigos temporários, aceite/recusa, relay SDP/ICE, TURN REST |
| `apps/desktop` | Electron + React: UI, captura, WebRTC, IPC → nut.js |

## Máquina de estados da sessão

`idle → host_registered → pending_request → accepted → connected → ended`

- Recusa/timeout em `pending_request` voltam para `host_registered`.
- Após aceite, o código é invalidado.
- Controle (`controlGranted`) é independente e padrão `false`.
- Reinício do app ou do servidor **não** restaura autorização.

## Segurança

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Preload expõe apenas funções nomeadas (sem IPC genérico).
- Captura e controle só após autorização local.
- DataChannel aceita somente eventos tipados (`mouse.*`, `key.*`, `input.release_all`).
- Logs não registram códigos, tokens, frames nem teclas.

## Estado do servidor

Estado em memória. Reiniciar o processo encerra todas as sessões. Múltiplas instâncias exigem store compartilhado (Redis etc.) — fora do MVP.

## Biblioteca nativa de entrada

**Escolha:** `@nut-tree-fork/nut-js` 4.2.6 (Apache-2.0).

Motivos:

- Pacote mantido, com bindings Windows (`libnut-win32`).
- Licença permissiva.
- Uso documentado em apps Electron com `asarUnpack` de `node_modules/@nut-tree-fork/**/*`.
- API de mouse/teclado adequada ao MVP.

Requer, no Windows, rebuild para o ABI do Electron quando os prebuilds não casarem (`npm run rebuild:native`). Visual Studio Build Tools / Windows SDK podem ser necessários.
