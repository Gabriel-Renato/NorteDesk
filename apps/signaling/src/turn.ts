import { createHmac, randomBytes } from 'node:crypto';
import { config } from './config.js';

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Credenciais TURN temporárias no estilo coturn use-auth-secret / TURN REST API.
 * O segredo permanece apenas no servidor; o cliente recebe username/credential de curta duração.
 */
export function buildIceServers(peerId: string): {
  iceServers: IceServerConfig[];
  ttlSeconds?: number;
} {
  const iceServers: IceServerConfig[] = [];

  if (config.stunUrls.length > 0) {
    iceServers.push({ urls: config.stunUrls });
  }

  if (config.turnUrls.length > 0 && config.turnSecret) {
    const ttl = config.turnCredentialTtlSeconds;
    const expiry = Math.floor(Date.now() / 1000) + ttl;
    const username = `${expiry}:${peerId}`;
    const credential = createHmac('sha1', config.turnSecret).update(username).digest('base64');
    iceServers.push({
      urls: config.turnUrls,
      username,
      credential,
    });
    return { iceServers, ttlSeconds: ttl };
  }

  if (config.turnUrls.length > 0) {
    // Sem segredo: útil apenas em lab com TURN aberto (não recomendado em produção).
    iceServers.push({ urls: config.turnUrls });
  }

  return { iceServers };
}

export function generateOpaqueToken(): string {
  return randomBytes(16).toString('hex');
}
