# Limitações e verificações pendentes

## Implementado neste repositório

- Monorepo com protocolo compartilhado, signaling e cliente Electron/React.
- Código temporário com TTL, aceite/recusa, pareamento e relay SDP/ICE.
- Captura de tela via `getDisplayMedia` + `setDisplayMediaRequestHandler`.
- WebRTC (vídeo) + DataChannel tipado para controle.
- Permissão de controle separada, revogação, limpeza de teclas/botões.
- Banner de sessão, encerramento bilateral, atalho global de emergência.
- Rate-limit, validação Zod, máquina de estados.
- Configuração electron-builder (NSIS), `.env.example`, docs TURN.
- Testes unitários de protocolo/signaling/coordenadas/rate-limit/limpeza.

## Pendente de validação em dois PCs Windows

- Carregamento real de `@nut-tree-fork/nut-js` no Electron empacotado.
- Alinhamento de cliques com DPI/escala em monitores reais.
- Instalador NSIS e avisos do SmartScreen (não assinado).
- WebRTC LAN e WAN com coturn.
- Comportamento sob perda de rede e kill forçado do processo.

## Fora do escopo (proposital)

- Acesso não supervisionado, auto-start, serviço.
- Controle de UAC / Winlogon / desktop seguro.
- Transferência de arquivos, clipboard, áudio, gravação.
- Múltiplas sessões simultâneas ou multi-monitor na mesma sessão.
- Identidade verificada do atendente.
