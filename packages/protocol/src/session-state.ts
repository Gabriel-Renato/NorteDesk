export const SessionStates = [
  'idle',
  'host_registered',
  'pending_request',
  'accepted',
  'connected',
  'ended',
] as const;

export type SessionState = (typeof SessionStates)[number];

export type SessionEvent =
  | 'HOST_REGISTER'
  | 'GUEST_REQUEST'
  | 'HOST_ACCEPT'
  | 'HOST_REJECT'
  | 'WEBRTC_READY'
  | 'END'
  | 'TIMEOUT'
  | 'DISCONNECT'
  | 'EXPIRE_CODE';

const TRANSITIONS: Record<SessionState, Partial<Record<SessionEvent, SessionState>>> = {
  idle: {
    HOST_REGISTER: 'host_registered',
    END: 'ended',
    DISCONNECT: 'ended',
  },
  host_registered: {
    GUEST_REQUEST: 'pending_request',
    EXPIRE_CODE: 'ended',
    END: 'ended',
    DISCONNECT: 'ended',
  },
  pending_request: {
    HOST_ACCEPT: 'accepted',
    HOST_REJECT: 'host_registered',
    TIMEOUT: 'host_registered',
    END: 'ended',
    DISCONNECT: 'ended',
    EXPIRE_CODE: 'ended',
  },
  accepted: {
    WEBRTC_READY: 'connected',
    END: 'ended',
    DISCONNECT: 'ended',
    TIMEOUT: 'ended',
  },
  connected: {
    END: 'ended',
    DISCONNECT: 'ended',
  },
  ended: {},
};

export function canTransition(from: SessionState, event: SessionEvent): boolean {
  return Boolean(TRANSITIONS[from]?.[event]);
}

export function transition(
  from: SessionState,
  event: SessionEvent,
): { ok: true; to: SessionState } | { ok: false; reason: string } {
  const to = TRANSITIONS[from]?.[event];
  if (!to) {
    return {
      ok: false,
      reason: `Transição inválida: ${from} + ${event}`,
    };
  }
  return { ok: true, to };
}

export function isTerminal(state: SessionState): boolean {
  return state === 'ended';
}

export function allowsSignaling(state: SessionState): boolean {
  return state === 'accepted' || state === 'connected';
}

export function allowsControl(state: SessionState, controlGranted: boolean): boolean {
  return state === 'connected' && controlGranted;
}
