import { describe, expect, it, beforeEach, vi } from 'vitest';
import { SessionStore } from './session-store.js';

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore();
  });

  it('expira e invalida código', () => {
    const host = store.createHostSession('host-1', 'Host');
    expect(host.code).toBeTruthy();

    // Força expiração
    host.codeExpiresAt = Date.now() - 1;
    const found = store.findByCode(host.code!);
    expect(found).toBeNull();
  });

  it('rejeita participante não autorizado na sinalização', () => {
    const host = store.createHostSession('host-1', 'Host');
    const req = store.requestAccess(host.code!, 'guest-1', 'Ana');
    expect(req.ok).toBe(true);
    if (!req.ok) return;

    expect(store.isAuthorizedParticipant(host.sessionId, 'intruso')).toBe(false);
    expect(store.isAuthorizedParticipant(host.sessionId, 'guest-1')).toBe(false);

    const accepted = store.accept(host.sessionId, 'host-1', req.requestId);
    expect(accepted.ok).toBe(true);
    expect(store.isAuthorizedParticipant(host.sessionId, 'guest-1')).toBe(true);
    expect(store.isAuthorizedParticipant(host.sessionId, 'intruso')).toBe(false);
  });

  it('não permite segunda solicitação substituir participante autorizado', () => {
    const host = store.createHostSession('host-1', 'Host');
    const first = store.requestAccess(host.code!, 'guest-1', 'Ana');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const accepted = store.accept(host.sessionId, 'host-1', first.requestId);
    expect(accepted.ok).toBe(true);

    // Código já foi invalidado após aceite
    const second = store.requestAccess(host.code ?? '000000000', 'guest-2', 'Bruno');
    expect(second.ok).toBe(false);
  });

  it('revoga controle sem encerrar sessão', () => {
    const host = store.createHostSession('host-1', 'Host');
    const req = store.requestAccess(host.code!, 'guest-1', 'Ana');
    if (!req.ok) throw new Error('request failed');
    store.accept(host.sessionId, 'host-1', req.requestId);
    store.markWebRtcReady(host.sessionId, 'host-1');

    const granted = store.setControl(host.sessionId, 'host-1', true);
    expect(granted.ok).toBe(true);
    if (granted.ok) expect(granted.session.controlGranted).toBe(true);

    const revoked = store.setControl(host.sessionId, 'host-1', false);
    expect(revoked.ok).toBe(true);
    if (revoked.ok) expect(revoked.session.controlGranted).toBe(false);
    expect(store.get(host.sessionId)?.state).toBe('connected');
  });

  it('reinício de autorização: encerrar invalida credenciais', () => {
    const host = store.createHostSession('host-1', 'Host');
    const code = host.code!;
    const req = store.requestAccess(code, 'guest-1', 'Ana');
    if (!req.ok) throw new Error('request failed');
    store.accept(host.sessionId, 'host-1', req.requestId);
    store.setControl(host.sessionId, 'host-1', true);
    store.endSession(host.sessionId, 'teste');

    expect(store.get(host.sessionId)).toBeUndefined();
    expect(store.findByCode(code)).toBeNull();
  });

  it('limita uso inválido de código via lookup', () => {
    expect(store.codeLookupResult('999999999')).toBe('invalid');
    const host = store.createHostSession('host-1', 'Host');
    expect(store.codeLookupResult(host.code!)).toBe('ok');
    store.requestAccess(host.code!, 'guest-1', 'Ana');
    expect(store.codeLookupResult(host.code!)).toBe('busy');
  });

  it('cleanup remove códigos expirados', () => {
    vi.useFakeTimers();
    const host = store.createHostSession('host-1', 'Host');
    const id = host.sessionId;
    host.codeExpiresAt = Date.now() - 1;
    store.cleanupExpired(Date.now());
    expect(store.get(id)).toBeUndefined();
    vi.useRealTimers();
  });
});
