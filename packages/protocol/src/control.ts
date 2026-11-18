import { z } from 'zod';

/** Somente eventos de entrada explicitamente definidos. Sem shell/scripts/caminhos. */
export const ControlEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('mouse.move'),
    /** Coordenadas normalizadas 0..1 relativas à área útil do vídeo (sem letterbox). */
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    ts: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('mouse.down'),
    button: z.enum(['left', 'right', 'middle']),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    ts: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('mouse.up'),
    button: z.enum(['left', 'right', 'middle']),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    ts: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('mouse.wheel'),
    deltaX: z.number().min(-50).max(50),
    deltaY: z.number().min(-50).max(50),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    ts: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('key.down'),
    key: z.string().min(1).max(40),
    code: z.string().min(1).max(40),
    ts: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('key.up'),
    key: z.string().min(1).max(40),
    code: z.string().min(1).max(40),
    ts: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('input.release_all'),
    ts: z.number().int().nonnegative(),
  }),
]);

export type ControlEvent = z.infer<typeof ControlEventSchema>;

export const MAX_CONTROL_MESSAGE_BYTES = 512;
export const MAX_CONTROL_EVENTS_PER_SECOND = 120;
export const MAX_MOUSE_MOVE_PER_SECOND = 60;

export function parseControlEvent(
  raw: unknown,
): { ok: true; data: ControlEvent } | { ok: false; error: string } {
  const result = ControlEventSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? 'Evento inválido' };
  }
  return { ok: true, data: result.data };
}

/** Códigos KeyboardEvent.code suportados no MVP (layout US base + modificadores). */
export const SUPPORTED_KEY_CODES = new Set([
  'KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyI', 'KeyJ',
  'KeyK', 'KeyL', 'KeyM', 'KeyN', 'KeyO', 'KeyP', 'KeyQ', 'KeyR', 'KeyS', 'KeyT',
  'KeyU', 'KeyV', 'KeyW', 'KeyX', 'KeyY', 'KeyZ',
  'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7',
  'Digit8', 'Digit9',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'Escape', 'Tab', 'CapsLock', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Space', 'Enter', 'Backspace',
  'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash',
  'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'Backquote',
  'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6',
  'Numpad7', 'Numpad8', 'Numpad9', 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply',
  'NumpadDivide', 'NumpadDecimal', 'NumpadEnter',
]);

export function isSupportedKeyCode(code: string): boolean {
  return SUPPORTED_KEY_CODES.has(code);
}
