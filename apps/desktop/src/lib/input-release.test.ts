import { describe, expect, it } from 'vitest';

/**
 * Espelha a lógica de limpeza de teclas/botões pressionados
 * (InputController.releaseAll) de forma unitária e portável.
 */
class PressedState {
  keys = new Set<string>();
  buttons = new Set<string>();

  pressKey(code: string): void {
    this.keys.add(code);
  }

  pressButton(button: string): void {
    this.buttons.add(button);
  }

  releaseAll(): { releasedKeys: string[]; releasedButtons: string[] } {
    const releasedKeys = [...this.keys];
    const releasedButtons = [...this.buttons];
    this.keys.clear();
    this.buttons.clear();
    return { releasedKeys, releasedButtons };
  }
}

describe('limpeza de teclas e botões', () => {
  it('descarta estado pressionado ao revogar/encerrar', () => {
    const state = new PressedState();
    state.pressKey('ControlLeft');
    state.pressKey('KeyA');
    state.pressButton('left');

    const result = state.releaseAll();
    expect(result.releasedKeys).toEqual(['ControlLeft', 'KeyA']);
    expect(result.releasedButtons).toEqual(['left']);
    expect(state.keys.size).toBe(0);
    expect(state.buttons.size).toBe(0);
  });
});
