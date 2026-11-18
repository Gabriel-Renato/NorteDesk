import type { ClientToServerMessage, ServerToClientMessage } from '@nortedesk/protocol';

type Handler = (msg: ServerToClientMessage) => void;

export type ConnectionStatus =
  | 'desconectado'
  | 'iniciando'
  | 'conectado'
  | 'erro_config'
  | 'erro';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const CLIENT_HEARTBEAT_MS = 10_000;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private readonly handlers = new Set<Handler>();
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private intentionalClose = false;
  private attempt = 0;
  private lastPeerId: string | null = null;
  status: ConnectionStatus = 'desconectado';
  peerId: string | null = null;
  onStatus?: (status: ConnectionStatus, detail?: string) => void;
  /** Disparado quando o peerId muda após reconexão (sessão anterior inválida). */
  onPeerReset?: (previousPeerId: string | null, nextPeerId: string) => void;

  constructor(private readonly url: string) {}

  connect(): void {
    this.intentionalClose = false;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.setStatus('iniciando', this.attempt === 0
      ? 'Iniciando servidor, aguarde…'
      : `Reconectando (tentativa ${this.attempt + 1})…`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.setStatus('erro', 'Falha ao abrir WebSocket');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('conectado');
      this.startPing();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data) as ServerToClientMessage;
        if (msg.type === 'welcome') {
          const previous = this.lastPeerId;
          this.peerId = msg.peerId;
          if (previous && previous !== msg.peerId) {
            this.onPeerReset?.(previous, msg.peerId);
          }
          this.lastPeerId = msg.peerId;
        }
        if (msg.type === 'pong') {
          // heartbeat ok
        }
        for (const h of this.handlers) h(msg);
      } catch {
        // ignorar
      }
    };

    ws.onerror = () => {
      // onclose trata a reconexão; status intermediário de espera
      if (this.status !== 'conectado') {
        this.setStatus('iniciando', 'Iniciando servidor, aguarde…');
      }
    };

    ws.onclose = () => {
      this.stopPing();
      this.ws = null;
      this.peerId = null;
      if (this.intentionalClose) {
        this.setStatus('desconectado');
        return;
      }
      this.setStatus('iniciando', 'Iniciando servidor, aguarde…');
      this.scheduleReconnect();
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopPing();
    this.ws?.close();
    this.ws = null;
    this.peerId = null;
    this.setStatus('desconectado');
  }

  send(msg: ClientToServerMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer != null) return;
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** Math.min(this.attempt, 5),
    );
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.send({ type: 'ping', ts: Date.now() });
    }, CLIENT_HEARTBEAT_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    this.status = status;
    this.onStatus?.(status, detail);
  }
}
