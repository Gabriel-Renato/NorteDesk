import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  assertMessageSize,
  parseClientMessage,
  SlidingWindowLimiter,
  type ClientToServerMessage,
  type ServerToClientMessage,
} from '@nortedesk/protocol';
import { config } from './config.js';
import { SessionStore } from './session-store.js';
import { buildIceServers } from './turn.js';

interface PeerContext {
  peerId: string;
  socket: WebSocket;
  remoteIp: string;
  lastPongAt: number;
  messageCountWindow: number[];
}

const MAX_MESSAGES_PER_SECOND = 40;

export class SignalingServer {
  private readonly store = new SessionStore();
  private readonly peers = new Map<string, PeerContext>();
  private readonly codeAttempts = new SlidingWindowLimiter(
    config.maxCodeAttemptsPerIp,
    config.codeAttemptWindowMs,
  );
  private readonly hostRequestLimiter = new SlidingWindowLimiter(
    config.maxRequestsPerHost,
    config.codeAttemptWindowMs,
  );
  private wss: WebSocketServer | null = null;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer = createServer((req, res) => {
        const pathOnly = (req.url ?? '/').split('?')[0];
        if (pathOnly === '/health' || pathOnly === '/health/') {
          // Sem versão, sessões, IPs ou segredos.
          res.writeHead(200, {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      this.wss = new WebSocketServer({ server: this.httpServer });
      this.wss.on('connection', (socket, req) => this.onConnection(socket, req));

      this.cleanupTimer = setInterval(() => this.tickCleanup(), 5_000);
      this.heartbeatTimer = setInterval(() => this.tickHeartbeat(), config.heartbeatIntervalMs);

      this.httpServer.listen(config.port, config.host, () => {
        console.log(`[signaling] ouvindo em ${config.host}:${config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const peer of this.peers.values()) {
      peer.socket.close();
    }
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
    await new Promise<void>((resolve, reject) => {
      this.httpServer?.close((err) => (err ? reject(err) : resolve()));
    });
  }

  /** Exposto para testes. */
  getStore(): SessionStore {
    return this.store;
  }

  private onConnection(socket: WebSocket, req: IncomingMessage): void {
    const peerId = randomUUID();
    const remoteIp = extractIp(req);
    const peer: PeerContext = {
      peerId,
      socket,
      remoteIp,
      lastPongAt: Date.now(),
      messageCountWindow: [],
    };
    this.peers.set(peerId, peer);

    this.send(peer, {
      type: 'welcome',
      peerId,
      serverTime: Date.now(),
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        this.sendError(peer, 'binary_nao_suportado', 'Mensagens binárias não são aceitas');
        return;
      }
      const raw = data.toString('utf8');
      this.handleRawMessage(peer, raw);
    });

    socket.on('close', () => this.onDisconnect(peerId));
    socket.on('error', () => this.onDisconnect(peerId));
  }

  private handleRawMessage(peer: PeerContext, raw: string): void {
    if (!assertMessageSize(raw)) {
      this.sendError(peer, 'mensagem_grande', 'Mensagem excede o tamanho máximo');
      return;
    }

    if (!this.allowMessageRate(peer)) {
      this.sendError(peer, 'rate_limit', 'Muitas mensagens; aguarde');
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.sendError(peer, 'json_invalido', 'JSON inválido');
      return;
    }

    const parsed = parseClientMessage(json);
    if (!parsed.ok) {
      this.sendError(peer, 'mensagem_invalida', parsed.error);
      return;
    }

    this.dispatch(peer, parsed.data);
  }

  private dispatch(peer: PeerContext, msg: ClientToServerMessage): void {
    switch (msg.type) {
      case 'ping':
        peer.lastPongAt = Date.now();
        this.send(peer, { type: 'pong', ts: msg.ts });
        return;
      case 'ice.config.request':
        this.sendIceConfig(peer);
        return;
      case 'host.register':
        this.handleHostRegister(peer, msg.displayName ?? 'Usuário local');
        return;
      case 'host.refresh_code':
        this.handleRefreshCode(peer);
        return;
      case 'guest.request':
        this.handleGuestRequest(peer, msg.code, msg.displayName);
        return;
      case 'host.accept':
        this.handleAccept(peer, msg.sessionId, msg.requestId);
        return;
      case 'host.reject':
        this.handleReject(peer, msg.sessionId, msg.requestId);
        return;
      case 'permission.set_control':
        this.handleSetControl(peer, msg.sessionId, msg.granted);
        return;
      case 'signal.offer':
      case 'signal.answer':
      case 'signal.ice':
        this.handleSignal(peer, msg);
        return;
      case 'webrtc.ready':
        this.handleWebRtcReady(peer, msg.sessionId);
        return;
      case 'session.end':
        this.handleEnd(peer, msg.sessionId, msg.reason ?? 'encerrado_pelo_usuario');
        return;
      default:
        this.sendError(peer, 'tipo_desconhecido', 'Tipo de mensagem não suportado');
    }
  }

  private handleHostRegister(peer: PeerContext, displayName: string): void {
    const session = this.store.createHostSession(peer.peerId, displayName);
    this.send(peer, {
      type: 'host.registered',
      code: session.code!,
      expiresAt: session.codeExpiresAt!,
      sessionId: session.sessionId,
    });
  }

  private handleRefreshCode(peer: PeerContext): void {
    const current = this.store.getByPeer(peer.peerId);
    if (!current) {
      this.sendError(peer, 'sem_sessao', 'Nenhuma sessão de host ativa');
      return;
    }
    const session = this.store.refreshCode(current.sessionId, peer.peerId);
    if (!session?.code || !session.codeExpiresAt) {
      this.sendError(peer, 'nao_pode_renovar', 'Não é possível renovar o código neste estado');
      return;
    }
    this.send(peer, {
      type: 'host.code_refreshed',
      code: session.code,
      expiresAt: session.codeExpiresAt,
      sessionId: session.sessionId,
    });
  }

  private handleGuestRequest(peer: PeerContext, code: string, displayName: string): void {
    const attempt = this.codeAttempts.tryConsume(peer.remoteIp);
    if (!attempt.allowed) {
      // Resposta uniforme para dificultar enumeração.
      this.sendError(
        peer,
        'codigo_invalido_ou_expirado',
        'Código inválido ou expirado',
        attempt.retryAfterMs,
      );
      return;
    }

    const result = this.store.requestAccess(code, peer.peerId, displayName);
    if (!result.ok) {
      // Mesma mensagem genérica para invalid/expired; busy é distinto (não revela código válido de forma útil além do estado).
      if (result.error === 'host_ocupado') {
        this.sendError(peer, 'host_ocupado', 'O computador remoto está ocupado ou já possui solicitação');
        return;
      }
      this.sendError(peer, 'codigo_invalido_ou_expirado', 'Código inválido ou expirado');
      return;
    }

    const hostLimit = this.hostRequestLimiter.tryConsume(result.session.hostPeerId);
    if (!hostLimit.allowed) {
      this.store.reject(result.session.sessionId, result.session.hostPeerId, result.requestId);
      this.sendError(peer, 'host_ocupado', 'Muitas solicitações para este host; tente mais tarde');
      return;
    }

    this.send(peer, {
      type: 'guest.request_sent',
      sessionId: result.session.sessionId,
      requestId: result.requestId,
    });

    const host = this.peers.get(result.session.hostPeerId);
    if (host) {
      this.send(host, {
        type: 'host.incoming_request',
        sessionId: result.session.sessionId,
        requestId: result.requestId,
        guestDisplayName: displayName,
        identityNote: 'nome_informado_nao_verificado',
      });
    }
  }

  private handleAccept(peer: PeerContext, sessionId: string, requestId: string): void {
    const result = this.store.accept(sessionId, peer.peerId, requestId);
    if (!result.ok) {
      this.sendError(peer, result.error, 'Não foi possível aceitar a solicitação');
      return;
    }

    const session = result.session;
    const guest = session.guestPeerId ? this.peers.get(session.guestPeerId) : undefined;

    this.send(peer, {
      type: 'session.accepted',
      sessionId: session.sessionId,
      role: 'host',
      peerDisplayName: session.guestDisplayName ?? 'Atendente',
    });
    this.send(peer, {
      type: 'session.state',
      sessionId: session.sessionId,
      state: session.state,
      controlGranted: false,
    });

    if (guest) {
      this.send(guest, {
        type: 'session.accepted',
        sessionId: session.sessionId,
        role: 'guest',
        peerDisplayName: session.hostDisplayName,
      });
      this.send(guest, {
        type: 'session.state',
        sessionId: session.sessionId,
        state: session.state,
        controlGranted: false,
      });
    }

    this.sendIceConfig(peer);
    if (guest) this.sendIceConfig(guest);
  }

  private handleReject(peer: PeerContext, sessionId: string, requestId: string): void {
    const result = this.store.reject(sessionId, peer.peerId, requestId);
    if (!result.ok) {
      this.sendError(peer, result.error, 'Não foi possível recusar a solicitação');
      return;
    }
    const guest = this.peers.get(result.guestPeerId);
    if (guest) {
      this.send(guest, {
        type: 'session.rejected',
        sessionId,
        reason: 'recusado_pelo_host',
      });
    }
  }

  private handleSetControl(peer: PeerContext, sessionId: string, granted: boolean): void {
    const result = this.store.setControl(sessionId, peer.peerId, granted);
    if (!result.ok) {
      this.sendError(peer, result.error, 'Não foi possível alterar a permissão de controle');
      return;
    }
    const session = result.session;
    const payload: ServerToClientMessage = {
      type: 'permission.control_changed',
      sessionId,
      granted,
    };
    this.send(peer, payload);
    if (session.guestPeerId) {
      const guest = this.peers.get(session.guestPeerId);
      if (guest) this.send(guest, payload);
    }
    this.broadcastState(session.sessionId);
  }

  private handleSignal(
    peer: PeerContext,
    msg: Extract<
      ClientToServerMessage,
      { type: 'signal.offer' | 'signal.answer' | 'signal.ice' }
    >,
  ): void {
    if (!this.store.isAuthorizedParticipant(msg.sessionId, peer.peerId)) {
      this.sendError(peer, 'nao_autorizado', 'Sinalização não autorizada para esta sessão');
      return;
    }
    const session = this.store.get(msg.sessionId);
    if (!session) return;

    const targetId =
      session.hostPeerId === peer.peerId ? session.guestPeerId : session.hostPeerId;
    if (!targetId) {
      this.sendError(peer, 'peer_ausente', 'Participante remoto ausente');
      return;
    }
    const target = this.peers.get(targetId);
    if (!target) {
      this.sendError(peer, 'peer_ausente', 'Participante remoto desconectado');
      return;
    }

    if (msg.type === 'signal.offer') {
      this.send(target, { type: 'signal.offer', sessionId: msg.sessionId, sdp: msg.sdp });
    } else if (msg.type === 'signal.answer') {
      this.send(target, { type: 'signal.answer', sessionId: msg.sessionId, sdp: msg.sdp });
    } else {
      this.send(target, {
        type: 'signal.ice',
        sessionId: msg.sessionId,
        candidate: msg.candidate,
        sdpMid: msg.sdpMid,
        sdpMLineIndex: msg.sdpMLineIndex,
      });
    }
  }

  private handleWebRtcReady(peer: PeerContext, sessionId: string): void {
    const result = this.store.markWebRtcReady(sessionId, peer.peerId);
    if (!result.ok) {
      this.sendError(peer, result.error, 'Não foi possível marcar WebRTC como pronto');
      return;
    }
    this.broadcastState(sessionId);
  }

  private handleEnd(peer: PeerContext, sessionId: string | undefined, reason: string): void {
    const session = sessionId
      ? this.store.get(sessionId)
      : this.store.getByPeer(peer.peerId);
    if (!session) {
      this.send(peer, { type: 'session.ended', reason });
      return;
    }
    if (session.hostPeerId !== peer.peerId && session.guestPeerId !== peer.peerId) {
      this.sendError(peer, 'nao_autorizado', 'Você não participa desta sessão');
      return;
    }
    this.terminateSession(session.sessionId, reason);
  }

  private terminateSession(sessionId: string, reason: string): void {
    const session = this.store.get(sessionId);
    if (!session) return;
    const hostId = session.hostPeerId;
    const guestId = session.guestPeerId;
    const pendingGuest = session.pending?.guestPeerId;
    this.store.endSession(sessionId, reason);

    const payload: ServerToClientMessage = {
      type: 'session.ended',
      sessionId,
      reason,
    };
    const host = this.peers.get(hostId);
    if (host) this.send(host, payload);
    if (guestId) {
      const guest = this.peers.get(guestId);
      if (guest) this.send(guest, payload);
    }
    if (pendingGuest && pendingGuest !== guestId) {
      const g = this.peers.get(pendingGuest);
      if (g) this.send(g, payload);
    }
  }

  private onDisconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    const session = this.store.getByPeer(peerId);
    if (!session) return;

    if (session.pending && session.pending.guestPeerId === peerId) {
      // Guest desistiu da solicitação pendente.
      this.store.reject(session.sessionId, session.hostPeerId, session.pending.requestId);
      const host = this.peers.get(session.hostPeerId);
      if (host) {
        this.send(host, {
          type: 'session.rejected',
          sessionId: session.sessionId,
          reason: 'guest_desconectou',
        });
      }
      return;
    }

    this.terminateSession(session.sessionId, 'peer_desconectou');
  }

  private sendIceConfig(peer: PeerContext): void {
    const { iceServers, ttlSeconds } = buildIceServers(peer.peerId);
    this.send(peer, {
      type: 'ice.config',
      iceServers,
      ttlSeconds,
    });
  }

  private broadcastState(sessionId: string): void {
    const session = this.store.get(sessionId);
    if (!session) return;
    const payload: ServerToClientMessage = {
      type: 'session.state',
      sessionId,
      state: session.state,
      controlGranted: session.controlGranted,
    };
    const host = this.peers.get(session.hostPeerId);
    if (host) this.send(host, payload);
    if (session.guestPeerId) {
      const guest = this.peers.get(session.guestPeerId);
      if (guest) this.send(guest, payload);
    }
  }

  private tickCleanup(): void {
    this.codeAttempts.prune();
    this.hostRequestLimiter.prune();
    const events = this.store.cleanupExpired();
    for (const ev of events) {
      if (ev.kind === 'codigo_expirado') {
        const payload: ServerToClientMessage = {
          type: 'session.ended',
          sessionId: ev.sessionId,
          reason: 'codigo_expirado',
        };
        if (ev.hostPeerId) {
          const host = this.peers.get(ev.hostPeerId);
          if (host) this.send(host, payload);
        }
        if (ev.guestPeerId) {
          const guest = this.peers.get(ev.guestPeerId);
          if (guest) this.send(guest, payload);
        }
      }
      if (ev.kind === 'request_timeout' && ev.guestPeerId) {
        const guest = this.peers.get(ev.guestPeerId);
        if (guest) {
          this.send(guest, {
            type: 'session.rejected',
            sessionId: ev.sessionId,
            reason: 'timeout',
          });
        }
      }
    }
  }

  private tickHeartbeat(): void {
    const now = Date.now();
    for (const peer of [...this.peers.values()]) {
      if (now - peer.lastPongAt > config.heartbeatTimeoutMs) {
        peer.socket.terminate();
        this.onDisconnect(peer.peerId);
        continue;
      }
      this.send(peer, { type: 'pong', ts: now });
    }
  }

  private allowMessageRate(peer: PeerContext): boolean {
    const now = Date.now();
    peer.messageCountWindow = peer.messageCountWindow.filter((t) => now - t < 1000);
    if (peer.messageCountWindow.length >= MAX_MESSAGES_PER_SECOND) return false;
    peer.messageCountWindow.push(now);
    return true;
  }

  private send(peer: PeerContext, msg: ServerToClientMessage): void {
    if (peer.socket.readyState !== WebSocket.OPEN) return;
    peer.socket.send(JSON.stringify(msg));
  }

  private sendError(
    peer: PeerContext,
    code: string,
    message: string,
    retryAfterMs?: number,
  ): void {
    this.send(peer, { type: 'error', code, message, retryAfterMs });
  }
}

function extractIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}
