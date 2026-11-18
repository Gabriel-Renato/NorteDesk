import type { ClientToServerMessage, ServerToClientMessage } from '@nortedesk/protocol';

type Handler = (msg: ServerToClientMessage) => void;

export type ConnectionStatus = 'desconectado' | 'conectando' | 'conectado' | 'erro';

export class SignalingClient {
  private ws: WebSocket | null = null;
  private readonly handlers = new Set<Handler>();
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private intentionalClose = false;
  status: ConnectionStatus = 'desconectado';
  peerId: string | null = null;
  onStatus?: (status: ConnectionStatus) => void;

  constructor(private readonly url: string) {}

  connect(): void {
    this.intentionalClose = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.setStatus('conectando');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.setStatus('conectado');
      this.startPing();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data) as ServerToClientMessage;
        if (msg.type === 'welcome') this.peerId = msg.peerId;
        for (const h of this.handlers) h(msg);
      } catch {
        // ignorar
      }
    };

    ws.onerror = () => {
      this.setStatus('erro');
    };

    ws.onclose = () => {
      this.stopPing();
      this.setStatus('desconectado');
      this.ws = null;
      if (!this.intentionalClose) {
        this.reconnectTimer = window.setTimeout(() => this.connect(), 2000);
      }
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.stopPing();
    this.ws?.close();
    this.ws = null;
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

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.send({ type: 'ping', ts: Date.now() });
    }, 10_000);
  }

  private stopPing(): void {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.onStatus?.(status);
  }
}
