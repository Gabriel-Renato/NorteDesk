# Roteiro manual (dois computadores Windows)

Pré-requisitos: Node 20+, app instalado ou `npm run dev` em ambos, servidor de sinalização acessível.

## A. Mesma rede (LAN)

1. Inicie o signaling em um PC (ou servidor na LAN): `npm run dev:signaling`.
2. Em ambos os apps, configure `VITE_SIGNALING_URL=ws://IP_DA_LAN:8787`.
3. Host: **Receber suporte** → anote o código e a validade.
4. Atendente: nome + código → **Solicitar acesso**.
5. Host: aceite a solicitação → selecione monitor → **Iniciar compartilhamento**.
6. Confirme vídeo no atendente (proporção preservada).
7. Sem autorizar controle: mouse/teclado do atendente **não** movem o host.
8. Host: **Autorizar controle** → teste mover, clicar, arrastar, rolar, atalhos.
9. Host: **Revogar controle** → eventos param; vídeo continua.
10. Encerre de um lado; o outro deve limpar sessão e sumir o banner.

## B. Redes diferentes com TURN

1. Configure coturn (`docs/turn-coturn.md`) e `TURN_*` no `.env`.
2. Use `wss://` / `https` em produção.
3. Repita o fluxo A. Se só STUN falhar, com TURN a sessão deve conectar (tráfego pode passar pelo relay).

## C. Aceite e recusa

1. Solicite acesso e **recuse** no host → atendente vê recusa; host pode receber novo pedido.
2. Solicite e ignore até timeout → rejeição por timeout.
3. Código expirado / errado → mensagem genérica (anti-enumeração).

## D. Falhas

1. Desligue Wi‑Fi no meio da sessão → captura/controle devem cessar; teclas liberadas.
2. Feche o app no Task Manager → o outro lado recebe encerramento.
3. Monitores com escalas 100%/125%/150% → cliques alinhados à área útil do vídeo (não nas faixas pretas).
4. Atalho Ctrl+Shift+Alt+Esc no host → encerra sessão.

## E. Limitações a observar (não são bugs do escopo)

- Apps elevados (UAC / “Executar como administrador”) podem não receber input do processo usuário comum.
- Layouts de teclado e acentos: suporte parcial via `KeyboardEvent.code`; não há IME completo.
- Sem áudio, clipboard sync, arquivo ou multi-monitor simultâneo.
