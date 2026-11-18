export type SignalingUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'ausente' | 'invalida' | 'ws_em_producao' };

/**
 * Resolve a URL do servidor de sinalização a partir de VITE_SIGNALING_URL.
 * Em produção a URL precisa ser definida no build (WSS). Não inventamos hosts remotos.
 */
export function resolveSignalingUrl(
  raw: string | undefined,
  options: { isDev: boolean } = { isDev: import.meta.env.DEV },
): SignalingUrlResult {
  const value = (raw ?? '').trim();

  if (!value) {
    if (options.isDev) {
      return { ok: true, url: 'ws://127.0.0.1:8787' };
    }
    return { ok: false, reason: 'ausente' };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'invalida' };
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return { ok: false, reason: 'invalida' };
  }

  if (!options.isDev && parsed.protocol === 'ws:' && !isLoopback(parsed.hostname)) {
    return { ok: false, reason: 'ws_em_producao' };
  }

  return { ok: true, url: parsed.toString().replace(/\/$/, '') };
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function signalingConfigMessage(
  reason: 'ausente' | 'invalida' | 'ws_em_producao',
): string {
  switch (reason) {
    case 'ausente':
      return 'URL do servidor não configurada. Defina VITE_SIGNALING_URL com a URL pública WSS do Render antes de gerar o app.';
    case 'invalida':
      return 'VITE_SIGNALING_URL inválida. Use uma URL ws:// (apenas local) ou wss:// (produção).';
    case 'ws_em_producao':
      return 'Em produção use WSS (wss://…), não WS sem TLS. Copie a URL HTTPS do Render e troque https:// por wss://.';
    default:
      return 'Configuração do servidor inválida.';
  }
}
