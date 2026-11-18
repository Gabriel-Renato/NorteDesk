import { describe, expect, it } from 'vitest';
import { resolveSignalingUrl } from './signaling-url';

describe('resolveSignalingUrl', () => {
  it('usa localhost em desenvolvimento sem variável', () => {
    expect(resolveSignalingUrl(undefined, { isDev: true })).toEqual({
      ok: true,
      url: 'ws://127.0.0.1:8787',
    });
  });

  it('falha em produção sem variável', () => {
    expect(resolveSignalingUrl('', { isDev: false })).toEqual({
      ok: false,
      reason: 'ausente',
    });
  });

  it('aceita wss de produção', () => {
    const result = resolveSignalingUrl('wss://exemplo.onrender.com', { isDev: false });
    expect(result).toEqual({ ok: true, url: 'wss://exemplo.onrender.com' });
  });

  it('rejeita ws remoto em produção', () => {
    expect(resolveSignalingUrl('ws://meu-servico.onrender.com', { isDev: false })).toEqual({
      ok: false,
      reason: 'ws_em_producao',
    });
  });

  it('rejeita http', () => {
    expect(resolveSignalingUrl('https://exemplo.onrender.com', { isDev: false })).toEqual({
      ok: false,
      reason: 'invalida',
    });
  });
});
