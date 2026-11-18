import { randomUUID } from 'node:crypto';
import {
  generateSessionCode,
  transition,
  type SessionState,
  type SessionEvent,
} from '@nortedesk/protocol';
import { config } from './config.js';

export interface PendingRequest {
  requestId: string;
  guestPeerId: string;
  guestDisplayName: string;
  createdAt: number;
}

export interface SessionRecord {
  sessionId: string;
  state: SessionState;
  hostPeerId: string;
  hostDisplayName: string;
  code: string | null;
  codeExpiresAt: number | null;
  guestPeerId: string | null;
  guestDisplayName: string | null;
  pending: PendingRequest | null;
  controlGranted: boolean;
  createdAt: number;
  updatedAt: number;
}

export class SessionStore {
  private readonly byId = new Map<string, SessionRecord>();
  private readonly codeIndex = new Map<string, string>();
  private readonly peerSession = new Map<string, string>();

  createHostSession(hostPeerId: string, hostDisplayName: string): SessionRecord {
    this.endPeerSessions(hostPeerId, 'nova_sessao_host');

    const sessionId = randomUUID();
    const code = this.allocateUniqueCode();
    const now = Date.now();
    const record: SessionRecord = {
      sessionId,
      state: 'idle',
      hostPeerId,
      hostDisplayName,
      code,
      codeExpiresAt: now + config.codeTtlMs,
      guestPeerId: null,
      guestDisplayName: null,
      pending: null,
      controlGranted: false,
      createdAt: now,
      updatedAt: now,
    };

    const moved = this.apply(record, 'HOST_REGISTER');
    if (!moved.ok) {
      throw new Error(moved.reason);
    }

    this.byId.set(sessionId, record);
    this.codeIndex.set(code, sessionId);
    this.peerSession.set(hostPeerId, sessionId);
    return record;
  }

  refreshCode(sessionId: string, hostPeerId: string): SessionRecord | null {
    const session = this.byId.get(sessionId);
    if (!session || session.hostPeerId !== hostPeerId) return null;
    if (session.state !== 'host_registered') return null;

    if (session.code) this.codeIndex.delete(session.code);
    const code = this.allocateUniqueCode();
    session.code = code;
    session.codeExpiresAt = Date.now() + config.codeTtlMs;
    session.updatedAt = Date.now();
    this.codeIndex.set(code, session.sessionId);
    return session;
  }

  findByCode(code: string): SessionRecord | null {
    const id = this.codeIndex.get(code);
    if (!id) return null;
    const session = this.byId.get(id) ?? null;
    if (!session) return null;
    if (!session.codeExpiresAt || session.codeExpiresAt < Date.now()) {
      this.endSession(session.sessionId, 'codigo_expirado');
      return null;
    }
    return session;
  }

  /** Lookup que não distingue existência — usado com rate-limit anti-enumeração. */
  codeLookupResult(code: string): 'invalid' | 'expired' | 'busy' | 'ok' {
    const id = this.codeIndex.get(code);
    if (!id) return 'invalid';
    const session = this.byId.get(id);
    if (!session) return 'invalid';
    if (!session.codeExpiresAt || session.codeExpiresAt < Date.now()) {
      this.endSession(session.sessionId, 'codigo_expirado');
      return 'expired';
    }
    if (session.state !== 'host_registered' || session.guestPeerId || session.pending) {
      return 'busy';
    }
    return 'ok';
  }

  requestAccess(
    code: string,
    guestPeerId: string,
    guestDisplayName: string,
  ):
    | { ok: true; session: SessionRecord; requestId: string }
    | { ok: false; error: string } {
    this.endPeerSessions(guestPeerId, 'nova_sessao_guest');

    const status = this.codeLookupResult(code);
    if (status === 'invalid' || status === 'expired') {
      return { ok: false, error: 'codigo_invalido_ou_expirado' };
    }
    if (status === 'busy') {
      return { ok: false, error: 'host_ocupado' };
    }

    const session = this.findByCode(code);
    if (!session) {
      return { ok: false, error: 'codigo_invalido_ou_expirado' };
    }
    if (session.hostPeerId === guestPeerId) {
      return { ok: false, error: 'nao_pode_conectar_a_si_mesmo' };
    }

    const moved = this.apply(session, 'GUEST_REQUEST');
    if (!moved.ok) {
      return { ok: false, error: 'transicao_invalida' };
    }

    const requestId = randomUUID();
    session.pending = {
      requestId,
      guestPeerId,
      guestDisplayName,
      createdAt: Date.now(),
    };
    session.updatedAt = Date.now();
    this.peerSession.set(guestPeerId, session.sessionId);
    return { ok: true, session, requestId };
  }

  accept(
    sessionId: string,
    hostPeerId: string,
    requestId: string,
  ): { ok: true; session: SessionRecord } | { ok: false; error: string } {
    const session = this.byId.get(sessionId);
    if (!session || session.hostPeerId !== hostPeerId) {
      return { ok: false, error: 'sessao_nao_encontrada' };
    }
    if (!session.pending || session.pending.requestId !== requestId) {
      return { ok: false, error: 'solicitacao_invalida' };
    }

    const moved = this.apply(session, 'HOST_ACCEPT');
    if (!moved.ok) return { ok: false, error: 'transicao_invalida' };

    session.guestPeerId = session.pending.guestPeerId;
    session.guestDisplayName = session.pending.guestDisplayName;
    session.pending = null;
    session.controlGranted = false;
    if (session.code) {
      this.codeIndex.delete(session.code);
      session.code = null;
      session.codeExpiresAt = null;
    }
    session.updatedAt = Date.now();
    return { ok: true, session };
  }

  reject(
    sessionId: string,
    hostPeerId: string,
    requestId: string,
  ): { ok: true; session: SessionRecord; guestPeerId: string } | { ok: false; error: string } {
    const session = this.byId.get(sessionId);
    if (!session || session.hostPeerId !== hostPeerId) {
      return { ok: false, error: 'sessao_nao_encontrada' };
    }
    if (!session.pending || session.pending.requestId !== requestId) {
      return { ok: false, error: 'solicitacao_invalida' };
    }

    const guestPeerId = session.pending.guestPeerId;
    const moved = this.apply(session, 'HOST_REJECT');
    if (!moved.ok) return { ok: false, error: 'transicao_invalida' };

    session.pending = null;
    this.peerSession.delete(guestPeerId);
    session.updatedAt = Date.now();
    return { ok: true, session, guestPeerId };
  }

  setControl(
    sessionId: string,
    hostPeerId: string,
    granted: boolean,
  ): { ok: true; session: SessionRecord } | { ok: false; error: string } {
    const session = this.byId.get(sessionId);
    if (!session || session.hostPeerId !== hostPeerId) {
      return { ok: false, error: 'sessao_nao_encontrada' };
    }
    if (session.state !== 'connected' && session.state !== 'accepted') {
      return { ok: false, error: 'estado_invalido' };
    }
    session.controlGranted = granted;
    session.updatedAt = Date.now();
    return { ok: true, session };
  }

  markWebRtcReady(
    sessionId: string,
    peerId: string,
  ): { ok: true; session: SessionRecord } | { ok: false; error: string } {
    const session = this.byId.get(sessionId);
    if (!session) return { ok: false, error: 'sessao_nao_encontrada' };
    if (session.hostPeerId !== peerId && session.guestPeerId !== peerId) {
      return { ok: false, error: 'nao_autorizado' };
    }
    if (session.state === 'connected') return { ok: true, session };
    const moved = this.apply(session, 'WEBRTC_READY');
    if (!moved.ok) return { ok: false, error: 'transicao_invalida' };
    session.updatedAt = Date.now();
    return { ok: true, session };
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.byId.get(sessionId);
  }

  getByPeer(peerId: string): SessionRecord | undefined {
    const id = this.peerSession.get(peerId);
    return id ? this.byId.get(id) : undefined;
  }

  isAuthorizedParticipant(sessionId: string, peerId: string): boolean {
    const session = this.byId.get(sessionId);
    if (!session) return false;
    if (session.state !== 'accepted' && session.state !== 'connected') return false;
    return session.hostPeerId === peerId || session.guestPeerId === peerId;
  }

  endSession(sessionId: string, _reason: string): SessionRecord | null {
    const session = this.byId.get(sessionId);
    if (!session) return null;

    if (session.state !== 'ended') {
      const moved = this.apply(session, 'END');
      if (!moved.ok) {
        this.apply(session, 'DISCONNECT');
      }
    }
    session.state = 'ended';
    session.controlGranted = false;
    session.pending = null;
    if (session.code) {
      this.codeIndex.delete(session.code);
      session.code = null;
    }
    this.peerSession.delete(session.hostPeerId);
    if (session.guestPeerId) this.peerSession.delete(session.guestPeerId);
    this.byId.delete(sessionId);
    return { ...session };
  }

  endPeerSessions(peerId: string, reason: string): void {
    const session = this.getByPeer(peerId);
    if (session) this.endSession(session.sessionId, reason);
  }

  listSessions(): SessionRecord[] {
    return [...this.byId.values()];
  }

  cleanupExpired(now = Date.now()): Array<{
    sessionId: string;
    kind: string;
    hostPeerId?: string;
    guestPeerId?: string;
  }> {
    const events: Array<{
      sessionId: string;
      kind: string;
      hostPeerId?: string;
      guestPeerId?: string;
    }> = [];
    for (const session of [...this.byId.values()]) {
      if (
        session.codeExpiresAt &&
        session.codeExpiresAt < now &&
        (session.state === 'host_registered' || session.state === 'pending_request')
      ) {
        const hostPeerId = session.hostPeerId;
        const guestPeerId = session.pending?.guestPeerId;
        const sessionId = session.sessionId;
        this.endSession(sessionId, 'codigo_expirado');
        events.push({ sessionId, kind: 'codigo_expirado', hostPeerId, guestPeerId });
        continue;
      }
      if (session.pending && session.pending.createdAt + config.requestTimeoutMs < now) {
        const guestPeerId = session.pending.guestPeerId;
        const moved = this.apply(session, 'TIMEOUT');
        if (moved.ok) {
          session.pending = null;
          this.peerSession.delete(guestPeerId);
          session.updatedAt = now;
          events.push({
            sessionId: session.sessionId,
            kind: 'request_timeout',
            hostPeerId: session.hostPeerId,
            guestPeerId,
          });
        }
      }
    }
    return events;
  }

  private apply(
    session: SessionRecord,
    event: SessionEvent,
  ): { ok: true } | { ok: false; reason: string } {
    const result = transition(session.state, event);
    if (!result.ok) return result;
    session.state = result.to;
    session.updatedAt = Date.now();
    return { ok: true };
  }

  private allocateUniqueCode(): string {
    for (let i = 0; i < 50; i++) {
      const code = generateSessionCode();
      if (!this.codeIndex.has(code)) return code;
    }
    throw new Error('Falha ao gerar código único');
  }
}
