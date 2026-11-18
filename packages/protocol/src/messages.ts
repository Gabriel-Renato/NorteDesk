import { z } from 'zod';

export const MAX_MESSAGE_BYTES = 64_000;
export const MAX_DISPLAY_NAME_LENGTH = 64;
export const MAX_SDP_LENGTH = 100_000;
export const MAX_ICE_CANDIDATE_LENGTH = 8_000;

const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_DISPLAY_NAME_LENGTH)
  .regex(/^[\p{L}\p{N}\s._\-–—()]+$/u, 'Nome inválido');

const SessionCodeSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => /^\d{9}$/.test(v), 'Código deve ter 9 dígitos');

const SessionIdSchema = z.string().uuid();
const PeerIdSchema = z.string().uuid();

export const ClientToServerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('host.register'),
    displayName: DisplayNameSchema.optional(),
  }),
  z.object({
    type: z.literal('host.refresh_code'),
  }),
  z.object({
    type: z.literal('guest.request'),
    code: SessionCodeSchema,
    displayName: DisplayNameSchema,
  }),
  z.object({
    type: z.literal('host.accept'),
    sessionId: SessionIdSchema,
    requestId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('host.reject'),
    sessionId: SessionIdSchema,
    requestId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('permission.set_control'),
    sessionId: SessionIdSchema,
    granted: z.boolean(),
  }),
  z.object({
    type: z.literal('signal.offer'),
    sessionId: SessionIdSchema,
    sdp: z.string().min(1).max(MAX_SDP_LENGTH),
  }),
  z.object({
    type: z.literal('signal.answer'),
    sessionId: SessionIdSchema,
    sdp: z.string().min(1).max(MAX_SDP_LENGTH),
  }),
  z.object({
    type: z.literal('signal.ice'),
    sessionId: SessionIdSchema,
    candidate: z.string().max(MAX_ICE_CANDIDATE_LENGTH),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().int().nullable().optional(),
  }),
  z.object({
    type: z.literal('session.end'),
    sessionId: SessionIdSchema.optional(),
    reason: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal('webrtc.ready'),
    sessionId: SessionIdSchema,
  }),
  z.object({
    type: z.literal('ping'),
    ts: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('ice.config.request'),
  }),
]);

export type ClientToServerMessage = z.infer<typeof ClientToServerSchema>;

export const ServerToClientSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    peerId: PeerIdSchema,
    serverTime: z.number().int(),
  }),
  z.object({
    type: z.literal('host.registered'),
    code: z.string(),
    expiresAt: z.number().int(),
    sessionId: SessionIdSchema,
  }),
  z.object({
    type: z.literal('host.code_refreshed'),
    code: z.string(),
    expiresAt: z.number().int(),
    sessionId: SessionIdSchema,
  }),
  z.object({
    type: z.literal('guest.request_sent'),
    sessionId: SessionIdSchema,
    requestId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('host.incoming_request'),
    sessionId: SessionIdSchema,
    requestId: z.string().uuid(),
    guestDisplayName: z.string(),
    /** Aviso: nome informado, não identidade verificada. */
    identityNote: z.literal('nome_informado_nao_verificado'),
  }),
  z.object({
    type: z.literal('session.accepted'),
    sessionId: SessionIdSchema,
    role: z.enum(['host', 'guest']),
    peerDisplayName: z.string(),
  }),
  z.object({
    type: z.literal('session.rejected'),
    sessionId: SessionIdSchema,
    reason: z.string(),
  }),
  z.object({
    type: z.literal('session.state'),
    sessionId: SessionIdSchema,
    state: z.string(),
    controlGranted: z.boolean(),
  }),
  z.object({
    type: z.literal('permission.control_changed'),
    sessionId: SessionIdSchema,
    granted: z.boolean(),
  }),
  z.object({
    type: z.literal('signal.offer'),
    sessionId: SessionIdSchema,
    sdp: z.string(),
  }),
  z.object({
    type: z.literal('signal.answer'),
    sessionId: SessionIdSchema,
    sdp: z.string(),
  }),
  z.object({
    type: z.literal('signal.ice'),
    sessionId: SessionIdSchema,
    candidate: z.string(),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().int().nullable().optional(),
  }),
  z.object({
    type: z.literal('session.ended'),
    sessionId: SessionIdSchema.optional(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('ice.config'),
    iceServers: z.array(
      z.object({
        urls: z.union([z.string(), z.array(z.string())]),
        username: z.string().optional(),
        credential: z.string().optional(),
      }),
    ),
    ttlSeconds: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    retryAfterMs: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('pong'),
    ts: z.number().int(),
  }),
]);

export type ServerToClientMessage = z.infer<typeof ServerToClientSchema>;

export function parseClientMessage(
  raw: unknown,
): { ok: true; data: ClientToServerMessage } | { ok: false; error: string } {
  const result = ClientToServerSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? 'Mensagem inválida' };
  }
  return { ok: true, data: result.data };
}

export function assertMessageSize(raw: string): boolean {
  return new TextEncoder().encode(raw).byteLength <= MAX_MESSAGE_BYTES;
}
