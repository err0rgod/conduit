import { z } from 'zod';

export const PROTOCOL_VERSION = '1.0' as const;

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

export const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION);

export const EnvelopeBaseSchema = z
  .object({
    id: z.string().uuid(),
    timestamp: z.number().int().nonnegative(),
    version: ProtocolVersionSchema,
    correlationId: z.string().uuid().optional(),
  })
  .strict();

export const ProtocolErrorSchema = z
  .object({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.unknown()).optional(),
  })
  .strict();

export const RequestEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.string().min(1),
  payload: z.unknown().optional(),
}).strict();

export const SuccessResponseEnvelopeSchema = EnvelopeBaseSchema.extend({
  success: z.literal(true),
  payload: z.unknown(),
}).strict();

export const ErrorResponseEnvelopeSchema = EnvelopeBaseSchema.extend({
  success: z.literal(false),
  error: ProtocolErrorSchema,
}).strict();

export const ResponseEnvelopeSchema = z.union([
  SuccessResponseEnvelopeSchema,
  ErrorResponseEnvelopeSchema,
]);

export const AuthRequestSchema = z
  .object({
    token: z.string().min(32).max(512),
  })
  .strict();

export const AuthMessageSchema = z
  .object({
    type: z.literal('auth'),
    payload: AuthRequestSchema,
  })
  .strict();

export const PermissionSchema = z.enum([
  'browser.read',
  'browser.navigate',
  'browser.interact',
  'browser.forms',
  'browser.submit',
  'browser.download',
  'browser.upload',
  'browser.cookies.read',
  'browser.cookies.write',
  'browser.clipboard.read',
  'browser.clipboard.write',
  'browser.dangerous',
]);

export const PairingCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/u);

export const ExtensionPairingCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{12}$/u);

export const ExtensionPairingRequestSchema = z
  .object({ code: ExtensionPairingCodeSchema })
  .strict();

export const DevicePublicKeySchema = z
  .string()
  .min(64)
  .max(4_096)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/u);

export const PairingRequestSchema = z
  .object({
    code: PairingCodeSchema,
    publicKey: DevicePublicKeySchema,
    deviceName: z.string().trim().min(1).max(120),
    requestedPermissions: z
      .array(PermissionSchema)
      .max(PermissionSchema.options.length)
      .default([]),
  })
  .strict();

export const PairingDecisionSchema = z
  .object({
    pairingId: z.string().uuid(),
    approved: z.boolean(),
    grantedPermissions: z.array(PermissionSchema).max(PermissionSchema.options.length).default([]),
  })
  .strict();

export const DeviceRevocationRequestSchema = z.object({ deviceId: z.string().uuid() }).strict();

export const RemoteChallengeRequestSchema = z
  .object({
    deviceId: z.string().uuid(),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export const RemoteAuthenticationSchema = z
  .object({
    deviceId: z.string().uuid(),
    challengeId: z.string().uuid(),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    signature: z
      .string()
      .min(64)
      .max(1_024)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  })
  .strict();

export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);

export const ConfirmationRequestSchema = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    operation: z.string().min(1),
    risk: RiskLevelSchema,
    summary: z.string().min(1).max(500),
    domain: z.string().optional(),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();

export const ConfirmationResponseSchema = z
  .object({
    confirmationId: z.string().uuid(),
    approved: z.boolean(),
  })
  .strict();

export const ExtensionConfirmationListRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('extension.confirmations.list'),
  payload: z.object({}).strict(),
}).strict();

export const ExtensionConfirmationRespondRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('extension.confirmations.respond'),
  payload: ConfirmationResponseSchema,
}).strict();

export const ExtensionManagementRequestSchema = z.discriminatedUnion('type', [
  ExtensionConfirmationListRequestSchema,
  ExtensionConfirmationRespondRequestSchema,
]);

export const BrowserOperationSchema = z.enum([
  'browser.list_tabs',
  'browser.get_active_tab',
  'browser.open_tab',
  'browser.close_tab',
  'browser.focus_tab',
  'browser.navigate',
  'browser.go_back',
  'browser.go_forward',
  'browser.reload',
  'browser.snapshot',
  'browser.get_visible_text',
  'browser.click',
  'browser.type',
  'browser.clear',
  'browser.select',
  'browser.hover',
  'browser.scroll',
  'browser.press_key',
  'browser.wait_for',
  'browser.screenshot',
  'browser.upload_file',
  'browser.get_downloads',
]);

export const BrowserTabSchema = z
  .object({
    id: z.number().int().nonnegative(),
    url: z.string(),
    title: z.string(),
    active: z.boolean(),
    windowId: z.number().int().optional(),
  })
  .strict();

export const BrowserTargetSchema = z
  .object({
    tabId: z.number().int().nonnegative().optional(),
  })
  .strict();

export const TabTargetSchema = z
  .object({
    tabId: z.number().int().nonnegative(),
  })
  .strict();

export const CoordinatesSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

export const ElementTargetSchema = z.union([
  z.object({ elementId: z.string().regex(/^e\d+$/) }).strict(),
  z.object({ role: z.string().min(1), name: z.string().min(1) }).strict(),
  z.object({ label: z.string().min(1) }).strict(),
  z.object({ text: z.string().min(1) }).strict(),
  z.object({ selector: z.string().min(1) }).strict(),
  z.object({ xpath: z.string().min(1) }).strict(),
  z.object({ coordinates: CoordinatesSchema }).strict(),
]);

export const SnapshotModeSchema = z.enum([
  'compact',
  'accessibility',
  'visible-text',
  'interactive',
  'full-dom',
  'targeted-subtree',
]);

export const BrowserListTabsRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.list_tabs'),
  payload: z.object({}).strict().optional().default({}),
}).strict();

export const BrowserGetActiveTabRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.get_active_tab'),
  payload: z.object({}).strict().optional().default({}),
}).strict();

export const BrowserOpenTabRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.open_tab'),
  payload: z
    .object({
      url: z.string().url().optional(),
    })
    .strict()
    .optional()
    .default({}),
}).strict();

export const BrowserTabRequestSchema = EnvelopeBaseSchema.extend({
  type: z.enum([
    'browser.close_tab',
    'browser.focus_tab',
    'browser.go_back',
    'browser.go_forward',
    'browser.reload',
  ]),
  payload: TabTargetSchema,
}).strict();

export const BrowserNavigateRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.navigate'),
  payload: BrowserTargetSchema.extend({
    url: z.string().url(),
  }).strict(),
}).strict();

export const BrowserSnapshotRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.snapshot'),
  payload: BrowserTargetSchema.extend({
    mode: SnapshotModeSchema.optional().default('compact'),
    elementId: z
      .string()
      .regex(/^e\d+$/)
      .optional(),
  }).strict(),
}).strict();

export const BrowserVisibleTextRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.get_visible_text'),
  payload: BrowserTargetSchema.optional().default({}),
}).strict();

export const BrowserClickRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.click'),
  payload: BrowserTargetSchema.extend({
    target: ElementTargetSchema,
  }).strict(),
}).strict();

export const BrowserTypeRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.type'),
  payload: BrowserTargetSchema.extend({
    target: ElementTargetSchema,
    text: z.string().max(100_000),
  }).strict(),
}).strict();

export const BrowserElementRequestSchema = EnvelopeBaseSchema.extend({
  type: z.enum(['browser.clear', 'browser.hover']),
  payload: BrowserTargetSchema.extend({ target: ElementTargetSchema }).strict(),
}).strict();

export const BrowserSelectRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.select'),
  payload: BrowserTargetSchema.extend({
    target: ElementTargetSchema,
    values: z.array(z.string()).min(1).max(100),
  }).strict(),
}).strict();

export const BrowserScrollRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.scroll'),
  payload: BrowserTargetSchema.extend({
    target: ElementTargetSchema.optional(),
    deltaX: z.number().finite().default(0),
    deltaY: z.number().finite().default(0),
  }).strict(),
}).strict();

export const BrowserPressKeyRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.press_key'),
  payload: BrowserTargetSchema.extend({
    key: z.string().min(1).max(100),
    modifiers: z
      .array(z.enum(['Alt', 'Control', 'Meta', 'Shift']))
      .max(4)
      .default([]),
  }).strict(),
}).strict();

export const BrowserWaitForRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.wait_for'),
  payload: BrowserTargetSchema.extend({
    selector: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    state: z.enum(['loading', 'interactive', 'complete']).optional(),
    timeoutMs: z.number().int().positive().max(120_000).default(15_000),
  }).refine((value) => Boolean(value.selector || value.text || value.url || value.state), {
    message: 'At least one wait condition is required.',
  }),
}).strict();

export const BrowserUploadFileRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.upload_file'),
  payload: BrowserTargetSchema.extend({
    target: ElementTargetSchema,
    files: z.array(z.string().min(1)).min(1).max(20),
  }).strict(),
}).strict();

export const BrowserGetDownloadsRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.get_downloads'),
  payload: z.object({}).strict().optional().default({}),
}).strict();

export const BrowserScreenshotRequestSchema = EnvelopeBaseSchema.extend({
  type: z.literal('browser.screenshot'),
  payload: BrowserTargetSchema.extend({
    format: z.enum(['png', 'jpeg']).optional().default('png'),
  })
    .strict()
    .optional()
    .default({}),
}).strict();

export const BrowserRequestEnvelopeSchema = z.discriminatedUnion('type', [
  BrowserListTabsRequestSchema,
  BrowserGetActiveTabRequestSchema,
  BrowserOpenTabRequestSchema,
  BrowserTabRequestSchema,
  BrowserNavigateRequestSchema,
  BrowserSnapshotRequestSchema,
  BrowserVisibleTextRequestSchema,
  BrowserClickRequestSchema,
  BrowserTypeRequestSchema,
  BrowserElementRequestSchema,
  BrowserSelectRequestSchema,
  BrowserScrollRequestSchema,
  BrowserPressKeyRequestSchema,
  BrowserWaitForRequestSchema,
  BrowserUploadFileRequestSchema,
  BrowserGetDownloadsRequestSchema,
  BrowserScreenshotRequestSchema,
]);

export const BoundsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();

export const SnapshotElementSchema = z
  .object({
    elementId: z.string().regex(/^e\d+$/),
    role: z.string().optional(),
    name: z.string(),
    text: z.string().optional(),
    tagName: z.string(),
    inputType: z.string().optional(),
    value: z.string().optional(),
    disabled: z.boolean(),
    selected: z.boolean().optional(),
    href: z.string().optional(),
    selector: z.string().optional(),
    bounds: BoundsSchema.optional(),
  })
  .strict();

export const PageSnapshotSchema = z
  .object({
    url: z.string(),
    title: z.string(),
    loadingState: z.enum(['loading', 'interactive', 'complete']),
    mode: SnapshotModeSchema,
    capturedAt: z.number().int().nonnegative(),
    visibleText: z.string(),
    elements: z.array(SnapshotElementSchema),
    frames: z
      .array(z.object({ url: z.string(), title: z.string().optional() }).strict())
      .default([]),
  })
  .strict();

export const ScreenshotResultSchema = z
  .object({
    mimeType: z.enum(['image/png', 'image/jpeg']),
    data: z.string().min(1),
  })
  .strict();

export function createEnvelopeBase(correlationId?: string): z.infer<typeof EnvelopeBaseSchema> {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    version: PROTOCOL_VERSION,
    ...(correlationId ? { correlationId } : {}),
  };
}

export function createSuccessResponse(payload: unknown, correlationId?: string): ResponseEnvelope {
  return {
    ...createEnvelopeBase(correlationId),
    success: true,
    payload,
  };
}

export function createErrorResponse(
  code: ErrorCode,
  message: string,
  correlationId?: string,
  details?: Record<string, unknown>,
): ResponseEnvelope {
  return {
    ...createEnvelopeBase(correlationId),
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;
export type AuthRequest = z.infer<typeof AuthRequestSchema>;
export type PairingRequest = z.infer<typeof PairingRequestSchema>;
export type PairingDecision = z.infer<typeof PairingDecisionSchema>;
export type DeviceRevocationRequest = z.infer<typeof DeviceRevocationRequestSchema>;
export type RemoteChallengeRequest = z.infer<typeof RemoteChallengeRequestSchema>;
export type RemoteAuthentication = z.infer<typeof RemoteAuthenticationSchema>;
export type Permission = z.infer<typeof PermissionSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type ConfirmationRequest = z.infer<typeof ConfirmationRequestSchema>;
export type ConfirmationResponse = z.infer<typeof ConfirmationResponseSchema>;
export type ExtensionManagementRequest = z.infer<typeof ExtensionManagementRequestSchema>;
export type BrowserOperation = z.infer<typeof BrowserOperationSchema>;
export type BrowserRequestEnvelope = z.infer<typeof BrowserRequestEnvelopeSchema>;
export type BrowserTab = z.infer<typeof BrowserTabSchema>;
export type BrowserTarget = z.infer<typeof BrowserTargetSchema>;
export type TabTarget = z.infer<typeof TabTargetSchema>;
export type ElementTarget = z.infer<typeof ElementTargetSchema>;
export type SnapshotMode = z.infer<typeof SnapshotModeSchema>;
export type SnapshotRequest = z.infer<typeof BrowserSnapshotRequestSchema>['payload'];
export type NavigateAction = z.infer<typeof BrowserNavigateRequestSchema>['payload'];
export type ClickAction = z.infer<typeof BrowserClickRequestSchema>['payload'];
export type TypeAction = z.infer<typeof BrowserTypeRequestSchema>['payload'];
export type SelectAction = z.infer<typeof BrowserSelectRequestSchema>['payload'];
export type ScrollAction = z.infer<typeof BrowserScrollRequestSchema>['payload'];
export type PressKeyAction = z.infer<typeof BrowserPressKeyRequestSchema>['payload'];
export type WaitForAction = z.infer<typeof BrowserWaitForRequestSchema>['payload'];
export type UploadFileAction = z.infer<typeof BrowserUploadFileRequestSchema>['payload'];
export type SnapshotElement = z.infer<typeof SnapshotElementSchema>;
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;
export type ScreenshotResult = z.infer<typeof ScreenshotResultSchema>;
