import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATION_FAILED',
  'PERMISSION_DENIED',
  'USER_CONFIRMATION_REQUIRED',
  'UNSUPPORTED_PROTOCOL_VERSION',
  'INVALID_REQUEST',
  'TAB_NOT_FOUND',
  'FRAME_NOT_FOUND',
  'ELEMENT_NOT_FOUND',
  'ELEMENT_REFERENCE_EXPIRED',
  'ELEMENT_NOT_INTERACTABLE',
  'NAVIGATION_TIMEOUT',
  'ACTION_TIMEOUT',
  'EXTENSION_DISCONNECTED',
  'DAEMON_UNAVAILABLE',
  'DOMAIN_NOT_ALLOWED',
  'FILE_ACCESS_DENIED',
  'PAIRING_CODE_EXPIRED',
  'DEVICE_REVOKED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
]);

export const ProtocolVersionSchema = z.literal('1.0');

export const EnvelopeBaseSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.number(),
  version: ProtocolVersionSchema,
});

export const RequestEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.string(),
  payload: z.unknown(),
  correlationId: z.string().uuid().optional(),
});

export const SuccessResponseEnvelopeSchema = EnvelopeBaseSchema.extend({
  success: z.literal(true),
  payload: z.unknown(),
  correlationId: z.string().uuid().optional(),
});

export const ErrorResponseEnvelopeSchema = EnvelopeBaseSchema.extend({
  success: z.literal(false),
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
  correlationId: z.string().uuid().optional(),
});

export const ResponseEnvelopeSchema = z.union([
  SuccessResponseEnvelopeSchema,
  ErrorResponseEnvelopeSchema,
]);

// Authentication
export const AuthRequestSchema = z.object({
  token: z.string(),
});

export const PairingRequestSchema = z.object({
  publicKey: z.string(),
  deviceName: z.string(),
});

// Browser Targets
export const TabTargetSchema = z.object({
  tabId: z.number(),
});

export const ElementTargetSchema = z.union([
  z.object({ elementId: z.string() }),
  z.object({ role: z.string(), name: z.string() }),
  z.object({ selector: z.string() }),
]);

// Actions
export const NavigateActionSchema = z.object({
  url: z.string().url(),
});

export const ClickActionSchema = z.object({
  target: ElementTargetSchema,
});

export const TypeActionSchema = z.object({
  target: ElementTargetSchema,
  text: z.string(),
});

// Snapshots
export const SnapshotModeSchema = z.enum([
  'compact',
  'accessibility',
  'visible-text',
  'interactive',
  'full-dom',
  'targeted-subtree',
]);

export const SnapshotRequestSchema = z.object({
  mode: SnapshotModeSchema.default('compact'),
});

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;
export type AuthRequest = z.infer<typeof AuthRequestSchema>;
export type PairingRequest = z.infer<typeof PairingRequestSchema>;
export type TabTarget = z.infer<typeof TabTargetSchema>;
export type ElementTarget = z.infer<typeof ElementTargetSchema>;
export type NavigateAction = z.infer<typeof NavigateActionSchema>;
export type ClickAction = z.infer<typeof ClickActionSchema>;
export type TypeAction = z.infer<typeof TypeActionSchema>;
export type SnapshotRequest = z.infer<typeof SnapshotRequestSchema>;
