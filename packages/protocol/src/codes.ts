import { randomInt } from 'node:crypto';

/** Código numérico de 9 dígitos, gerado com fonte criptograficamente segura. */
export function generateSessionCode(): string {
  const n = randomInt(0, 1_000_000_000);
  return n.toString().padStart(9, '0');
}

export function normalizeSessionCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 9);
}

export function formatSessionCode(code: string): string {
  const n = normalizeSessionCode(code);
  if (n.length !== 9) return n;
  return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 9)}`;
}

export function isValidSessionCodeFormat(code: string): boolean {
  return /^\d{9}$/.test(normalizeSessionCode(code));
}
