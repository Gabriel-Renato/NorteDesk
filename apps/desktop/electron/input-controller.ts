import { createRequire } from 'node:module';
import type { ControlEvent } from '@nortedesk/protocol';
import {
  isSupportedKeyCode,
  normalizedToDisplayPoint,
  type DisplayBounds,
} from '@nortedesk/protocol';

const require = createRequire(import.meta.url);

export interface InputControllerOptions {
  getDisplay: () => DisplayBounds | null;
  isControlAllowed: () => boolean;
}

type ButtonName = 'left' | 'right' | 'middle';

/**
 * Camada nativa de entrada — NUNCA executar no renderer.
 * Biblioteca: @nut-tree-fork/nut-js (Apache-2.0), com bindings nativos por plataforma.
 * No Windows exige o módulo libnut-win32; pode precisar de electron-rebuild.
 */
export class InputController {
  private enabled = false;
  private pressedKeys = new Set<string>();
  private pressedButtons = new Set<ButtonName>();
  private nut: NutApi | null = null;
  private loadError: string | null = null;
  private eventCountWindow: number[] = [];

  constructor(private readonly options: InputControllerOptions) {
    this.tryLoadNut();
  }

  getAvailability(): { ok: boolean; detail: string } {
    if (this.nut) return { ok: true, detail: 'nativo_carregado' };
    return {
      ok: false,
      detail: this.loadError ?? 'modulo_nativo_indisponivel',
    };
  }

  setEnabled(enabled: boolean): void {
    if (!enabled && this.enabled) {
      void this.releaseAll();
    }
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async handleEvent(event: ControlEvent): Promise<{ applied: boolean; reason?: string }> {
    if (!this.enabled || !this.options.isControlAllowed()) {
      return { applied: false, reason: 'controle_desabilitado' };
    }
    if (!this.nut) {
      return { applied: false, reason: this.loadError ?? 'nativo_indisponivel' };
    }
    if (!this.allowRate()) {
      return { applied: false, reason: 'rate_limit' };
    }

    try {
      switch (event.type) {
        case 'mouse.move':
          await this.moveTo(event.x, event.y);
          return { applied: true };
        case 'mouse.down':
          await this.moveTo(event.x, event.y);
          await this.nut.mouse.pressButton(this.mapButton(event.button));
          this.pressedButtons.add(event.button);
          return { applied: true };
        case 'mouse.up':
          await this.moveTo(event.x, event.y);
          await this.nut.mouse.releaseButton(this.mapButton(event.button));
          this.pressedButtons.delete(event.button);
          return { applied: true };
        case 'mouse.wheel': {
          await this.moveTo(event.x, event.y);
          const stepsY = Math.trunc(event.deltaY);
          if (stepsY !== 0) {
            await this.nut.mouse.scrollDown(stepsY > 0 ? stepsY : 0);
            await this.nut.mouse.scrollUp(stepsY < 0 ? -stepsY : 0);
          }
          const stepsX = Math.trunc(event.deltaX);
          if (stepsX !== 0) {
            await this.nut.mouse.scrollRight(stepsX > 0 ? stepsX : 0);
            await this.nut.mouse.scrollLeft(stepsX < 0 ? -stepsX : 0);
          }
          return { applied: true };
        }
        case 'key.down': {
          const key = this.mapKey(event.code);
          if (!key) return { applied: false, reason: 'tecla_nao_suportada' };
          await this.nut.keyboard.pressKey(key);
          this.pressedKeys.add(event.code);
          return { applied: true };
        }
        case 'key.up': {
          const key = this.mapKey(event.code);
          if (!key) return { applied: false, reason: 'tecla_nao_suportada' };
          await this.nut.keyboard.releaseKey(key);
          this.pressedKeys.delete(event.code);
          return { applied: true };
        }
        case 'input.release_all':
          await this.releaseAll();
          return { applied: true };
        default:
          return { applied: false, reason: 'tipo_desconhecido' };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro_nativo';
      return { applied: false, reason: message };
    }
  }

  async releaseAll(): Promise<void> {
    if (!this.nut) {
      this.pressedKeys.clear();
      this.pressedButtons.clear();
      return;
    }
    for (const code of [...this.pressedKeys]) {
      const key = this.mapKey(code);
      if (key) {
        try {
          await this.nut.keyboard.releaseKey(key);
        } catch {
          // ignorar falhas individuais na limpeza
        }
      }
    }
    for (const button of [...this.pressedButtons]) {
      try {
        await this.nut.mouse.releaseButton(this.mapButton(button));
      } catch {
        // ignorar
      }
    }
    this.pressedKeys.clear();
    this.pressedButtons.clear();
  }

  getPressedSnapshot(): { keys: string[]; buttons: string[] } {
    return {
      keys: [...this.pressedKeys],
      buttons: [...this.pressedButtons],
    };
  }

  private async moveTo(nx: number, ny: number): Promise<void> {
    if (!this.nut) return;
    const display = this.options.getDisplay();
    if (!display) return;
    const point = normalizedToDisplayPoint(
      { x: nx, y: ny },
      display,
      { usePhysicalPixels: process.platform === 'win32' },
    );
    await this.nut.mouse.setPosition(new this.nut.Point(point.x, point.y));
  }

  private mapButton(button: ButtonName): unknown {
    if (!this.nut) throw new Error('nut_ausente');
    const map: Record<ButtonName, unknown> = {
      left: this.nut.Button.LEFT,
      right: this.nut.Button.RIGHT,
      middle: this.nut.Button.MIDDLE,
    };
    return map[button];
  }

  private mapKey(code: string): unknown | null {
    if (!this.nut) return null;
    if (!isSupportedKeyCode(code)) return null;
    const Key = this.nut.Key as Record<string, unknown>;

    const table: Record<string, string> = {
      Escape: 'Escape',
      Tab: 'Tab',
      CapsLock: 'CapsLock',
      ShiftLeft: 'LeftShift',
      ShiftRight: 'RightShift',
      ControlLeft: 'LeftControl',
      ControlRight: 'RightControl',
      AltLeft: 'LeftAlt',
      AltRight: 'RightAlt',
      MetaLeft: 'LeftSuper',
      MetaRight: 'RightSuper',
      Space: 'Space',
      Enter: 'Return',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Insert: 'Insert',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Minus: 'Minus',
      Equal: 'Equal',
      BracketLeft: 'LeftBracket',
      BracketRight: 'RightBracket',
      Backslash: 'Backslash',
      Semicolon: 'Semicolon',
      Quote: 'Quote',
      Comma: 'Comma',
      Period: 'Period',
      Slash: 'Slash',
      Backquote: 'Grave',
      NumpadAdd: 'Add',
      NumpadSubtract: 'Subtract',
      NumpadMultiply: 'Multiply',
      NumpadDivide: 'Divide',
      NumpadDecimal: 'Decimal',
      NumpadEnter: 'Return',
    };

    if (code.startsWith('Key') && code.length === 4) {
      return Key[code.slice(3)] ?? null;
    }
    if (code.startsWith('Digit') && code.length === 6) {
      return Key[`Num${code.slice(5)}`] ?? Key[code.slice(5)] ?? null;
    }
    if (code.startsWith('F') && /^F\d{1,2}$/.test(code)) {
      return Key[code] ?? null;
    }
    if (code.startsWith('Numpad') && /^Numpad\d$/.test(code)) {
      return Key[`NumPad${code.slice(6)}`] ?? null;
    }
    const mapped = table[code];
    return mapped ? (Key[mapped] ?? null) : null;
  }

  private allowRate(): boolean {
    const now = Date.now();
    this.eventCountWindow = this.eventCountWindow.filter((t) => now - t < 1000);
    if (this.eventCountWindow.length >= 120) return false;
    this.eventCountWindow.push(now);
    return true;
  }

  private tryLoadNut(): void {
    if (process.platform !== 'win32' && process.env.NORTEDESK_FORCE_NATIVE !== '1') {
      this.loadError =
        'Automação nativa disponível de forma completa no Windows; neste SO o módulo pode falhar ou ter limitações.';
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@nut-tree-fork/nut-js') as NutApi;
      this.nut = mod;
      // Reduzir atraso padrão do nut.js para controle remoto
      if (mod.mouse && typeof mod.mouse.config === 'object') {
        mod.mouse.config.autoDelayMs = 0;
        mod.mouse.config.mouseSpeed = 3000;
      }
      if (mod.keyboard && typeof mod.keyboard.config === 'object') {
        mod.keyboard.config.autoDelayMs = 0;
      }
    } catch (err) {
      this.nut = null;
      this.loadError =
        err instanceof Error
          ? `Falha ao carregar @nut-tree-fork/nut-js: ${err.message}`
          : 'Falha ao carregar módulo nativo';
    }
  }
}

interface NutApi {
  mouse: {
    setPosition: (p: unknown) => Promise<void>;
    pressButton: (b: unknown) => Promise<void>;
    releaseButton: (b: unknown) => Promise<void>;
    scrollUp: (n: number) => Promise<void>;
    scrollDown: (n: number) => Promise<void>;
    scrollLeft: (n: number) => Promise<void>;
    scrollRight: (n: number) => Promise<void>;
    config: { autoDelayMs: number; mouseSpeed: number };
  };
  keyboard: {
    pressKey: (...keys: unknown[]) => Promise<void>;
    releaseKey: (...keys: unknown[]) => Promise<void>;
    config: { autoDelayMs: number };
  };
  Point: new (x: number, y: number) => unknown;
  Button: { LEFT: unknown; RIGHT: unknown; MIDDLE: unknown };
  Key: Record<string, unknown>;
}
