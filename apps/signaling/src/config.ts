import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: path.join(root, '.env') });

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Render injeta PORT. Preferimos PORT; SIGNALING_PORT fica para desenvolvimento local.
 * Host padrão 0.0.0.0 (obrigatório em PaaS).
 */
function resolvePort(): number {
  if (process.env.PORT) {
    const n = Number.parseInt(process.env.PORT, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return intEnv('SIGNALING_PORT', 8787);
}

export const config = {
  host: process.env.SIGNALING_HOST ?? '0.0.0.0',
  port: resolvePort(),
  codeTtlMs: intEnv('CODE_TTL_MS', 10 * 60 * 1000),
  maxCodeAttemptsPerIp: intEnv('MAX_CODE_ATTEMPTS_PER_IP', 10),
  codeAttemptWindowMs: intEnv('CODE_ATTEMPT_WINDOW_MS', 60_000),
  maxRequestsPerHost: intEnv('MAX_REQUESTS_PER_HOST', 5),
  heartbeatIntervalMs: intEnv('HEARTBEAT_INTERVAL_MS', 15_000),
  heartbeatTimeoutMs: intEnv('HEARTBEAT_TIMEOUT_MS', 45_000),
  requestTimeoutMs: intEnv('REQUEST_TIMEOUT_MS', 60_000),
  stunUrls: (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  turnUrls: (process.env.TURN_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  turnSecret: process.env.TURN_SECRET ?? '',
  turnCredentialTtlSeconds: intEnv('TURN_CREDENTIAL_TTL_SECONDS', 3600),
};
