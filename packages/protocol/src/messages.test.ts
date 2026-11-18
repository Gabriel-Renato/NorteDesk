import { describe, expect, it } from 'vitest';
import { parseClientMessage, assertMessageSize, MAX_MESSAGE_BYTES } from './messages.js';
import { parseControlEvent } from './control.js';

describe('validação de mensagens', () => {
  it('aceita solicitação de guest válida', () => {
    const result = parseClientMessage({
      type: 'guest.request',
      code: '123 456 789',
      displayName: 'Atendente Ana',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.type).toBe('guest.request');
      if (result.data.type === 'guest.request') {
        expect(result.data.code).toBe('123456789');
      }
    }
  });

  it('rejeita código com formato inválido', () => {
    const result = parseClientMessage({
      type: 'guest.request',
      code: 'abc',
      displayName: 'Ana',
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita nome com caracteres perigosos', () => {
    const result = parseClientMessage({
      type: 'guest.request',
      code: '123456789',
      displayName: '<script>alert(1)</script>',
    });
    expect(result.ok).toBe(false);
  });

  it('limita tamanho da mensagem', () => {
    expect(assertMessageSize('x'.repeat(100))).toBe(true);
    expect(assertMessageSize('x'.repeat(MAX_MESSAGE_BYTES + 1))).toBe(false);
  });

  it('rejeita evento de controle com tipo desconhecido', () => {
    const result = parseControlEvent({
      type: 'shell.exec',
      command: 'calc.exe',
      ts: 1,
    });
    expect(result.ok).toBe(false);
  });

  it('aceita mouse.move válido', () => {
    const result = parseControlEvent({
      type: 'mouse.move',
      x: 0.5,
      y: 0.5,
      ts: Date.now(),
    });
    expect(result.ok).toBe(true);
  });

  it('rejeita coordenadas fora de 0..1', () => {
    const result = parseControlEvent({
      type: 'mouse.move',
      x: 1.5,
      y: 0.2,
      ts: 1,
    });
    expect(result.ok).toBe(false);
  });
});
