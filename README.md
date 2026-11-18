# NorteDesk

MVP de **suporte remoto consentido** (fluxo semelhante ao AnyDesk): código temporário, aceite local, compartilhamento de tela via WebRTC e controle de mouse/teclado somente após autorização explícita.

## O que este repositório contém

| Caminho | Conteúdo |
|---------|----------|
| `apps/desktop` | Cliente Windows (Electron + React + TypeScript + Vite) |
| `apps/signaling` | Servidor de sinalização WebSocket (Node.js + TypeScript) |
| `packages/protocol` | Contratos, validação Zod, máquina de estados, coordenadas |
| `docs/` | Arquitetura, TURN/coturn, roteiro de testes manuais |

## Decisão: automação de entrada no Windows

Biblioteca escolhida: **`@nut-tree-fork/nut-js` (4.x, Apache-2.0)**.

- Mantida e usada em projetos Electron.
- Bindings nativos Windows (`@nut-tree-fork/libnut-win32`).
- Empacotamento: `asarUnpack` de `node_modules/@nut-tree-fork/**/*`.
- Se o prebuild não carregar no Electron alvo, rode `npm run rebuild:native` **no Windows** com Visual Studio Build Tools + Windows SDK.

A aplicação de eventos ocorre **somente no processo principal** do Electron, via IPC restrito. O renderer nunca injeta input diretamente.

## Requisitos

- Node.js **20+** (testado com 20.x)
- npm 10+
- Para **instalador / módulo nativo**: máquina Windows 10/11 x64, Visual Studio Build Tools (C++), Python 3 (node-gyp)
- Servidor de sinalização acessível pelos dois PCs
- Para redes diferentes: servidor TURN (coturn) — ver `docs/turn-coturn.md`

## Configuração rápida

```bash
cp .env.example .env
npm install
npm run build:protocol
```

Ajuste no `.env`:

- `SIGNALING_PORT` / `VITE_SIGNALING_URL` (ex.: `ws://127.0.0.1:8787` ou `ws://IP_LAN:8787`)
- Opcional: `TURN_URLS`, `TURN_SECRET` (nunca no binário do app)

## Desenvolvimento

Em um terminal (protocolo + signaling + desktop):

```bash
npm run dev
```

Ou separado:

```bash
npm run dev:signaling
npm run dev:desktop
```

O Vite sobe a UI; o Electron abre automaticamente via `vite-plugin-electron`.

## Testes automatizados

```bash
npm test
```

Cobre: expiração/uso de códigos, participantes não autorizados, transições inválidas, revogação de controle, validação de mensagens, coordenadas com letterbox/escala, limpeza de teclas/botões, rate-limit.

## Build e instalador Windows

**Execute no Windows** (WSL/Linux não valida o instalador NSIS nem o binding nativo de forma definitiva):

```bash
npm install
npm run rebuild:native
npm run dist:win
```

Artefato em `apps/desktop/release/NorteDesk-Setup-*.exe`.

### Assinatura de código

O instalador gerado por este MVP **não está assinado**. O Windows SmartScreen e o Defender podem exibir avisos em distribuição sem certificado Authenticode. Não afirmamos que o instalador esteja assinado.

## Fluxo do usuário

1. Host: **Receber suporte** → código temporário (copia / validade).
2. Atendente: informa código + nome → **Solicitar acesso**.
3. Host: aceita ou recusa (nome é **informado, não verificado**).
4. Host: escolhe o monitor → inicia compartilhamento.
5. Host: autoriza controle em passo separado (padrão: desligado).
6. Qualquer lado encerra; atalho global **Ctrl+Shift+Alt+Esc** força fim e libera teclas/botões.

## Segurança (resumo)

- Sem captura/controle antes do aceite local.
- Código criptograficamente seguro, com TTL; não concede acesso sozinho.
- Rate-limit de tentativas e de solicitações; respostas genéricas anti-enumeração.
- Permissões de visualização e controle separadas; não sobrevivem a reconexão.
- CSP, `contextIsolation`, sandbox, preload mínimo, bloqueio de navegação/janelas.
- Produção: use **WSS/HTTPS**; não use WS aberto na internet.

## Limitações honestas do MVP

- Uma sessão / um monitor por vez.
- Sem acesso não supervisionado, serviço em background, UAC/login screen, arquivos, clipboard, áudio ou gravação.
- Teclado: mapeamento por `code` (base US + modificadores). **Acentos e IME não têm suporte completo.**
- Processo em contexto de usuário comum: janelas elevadas podem não receber input.
- STUN sozinho **não** promete funcionar entre redes arbitrárias — configure TURN.
- Estado do signaling em memória: reinício do servidor derruba sessões.
- Ambiente de CI/desenvolvimento atual pode ser Linux/WSL: protocolo e signaling são verificáveis aqui; **automação nativa e instalador dependem de validação em dois PCs Windows**.

## Verificação neste ambiente

Consulte `docs/roteiro-testes-manuais.md` para o checklist entre dois Windows.

O que costuma ser validável sem Windows:

- build TypeScript do monorepo
- testes unitários de protocolo/signaling
- subida do servidor de sinalização

O que **depende de Windows + dois PCs**:

- `@nut-tree-fork/nut-js` aplicando mouse/teclado
- captura `getDisplayMedia` / `desktopCapturer`
- instalador NSIS e comportamento SmartScreen
- WebRTC real (LAN e WAN+TURN)

## Documentação adicional

- [Arquitetura](docs/arquitetura.md)
- [TURN / coturn](docs/turn-coturn.md)
- [Roteiro de testes manuais](docs/roteiro-testes-manuais.md)
