/** Inteiro aleatório seguro — funciona no Node e no renderer (Web Crypto). */
function secureRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error('maxExclusive inválido');
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Evita viés grosseiro para o intervalo 1e9 (cabe em 32 bits).
  return buf[0]! % maxExclusive;
}

/** Código numérico de 9 dígitos, gerado com fonte criptograficamente segura. */
export function generateSessionCode(): string {
  const n = secureRandomInt(1_000_000_000);
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
