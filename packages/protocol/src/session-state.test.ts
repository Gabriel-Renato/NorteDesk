import { describe, expect, it } from 'vitest';
import { canTransition, transition, allowsControl, allowsSignaling } from './session-state.js';

describe('máquina de estados da sessão', () => {
  it('permite registro do host a partir de idle', () => {
    expect(canTransition('idle', 'HOST_REGISTER')).toBe(true);
    expect(transition('idle', 'HOST_REGISTER')).toEqual({ ok: true, to: 'host_registered' });
  });

  it('rejeita aceite sem solicitação pendente', () => {
    const result = transition('host_registered', 'HOST_ACCEPT');
    expect(result.ok).toBe(false);
  });

  it('fluxo feliz até connected', () => {
    let state = transition('idle', 'HOST_REGISTER');
    expect(state).toEqual({ ok: true, to: 'host_registered' });
    state = transition('host_registered', 'GUEST_REQUEST');
    expect(state).toEqual({ ok: true, to: 'pending_request' });
    state = transition('pending_request', 'HOST_ACCEPT');
    expect(state).toEqual({ ok: true, to: 'accepted' });
    state = transition('accepted', 'WEBRTC_READY');
    expect(state).toEqual({ ok: true, to: 'connected' });
  });

  it('recusa volta para host_registered', () => {
    expect(transition('pending_request', 'HOST_REJECT')).toEqual({
      ok: true,
      to: 'host_registered',
    });
  });

  it('não permite sinalização antes do aceite', () => {
    expect(allowsSignaling('pending_request')).toBe(false);
    expect(allowsSignaling('accepted')).toBe(true);
  });

  it('controle só em connected com permissão', () => {
    expect(allowsControl('connected', false)).toBe(false);
    expect(allowsControl('connected', true)).toBe(true);
    expect(allowsControl('accepted', true)).toBe(false);
  });

  it('ended é terminal', () => {
    expect(canTransition('ended', 'HOST_REGISTER')).toBe(false);
    expect(canTransition('ended', 'GUEST_REQUEST')).toBe(false);
  });
});
