import { describe, expect, it } from 'vitest';
import {
  BrowserRequestEnvelopeSchema,
  AuditEventSchema,
  ConfirmationRequestSchema,
  ConfirmationResponseSchema,
  ExtensionManagementRequestSchema,
  PageSnapshotSchema,
  PairingRequestSchema,
  RemoteAuthenticationSchema,
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  createErrorResponse,
  createSuccessResponse,
} from '../src/index';

const baseEnvelope = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  timestamp: 1_720_000_000_000,
  version: '1.0',
};

describe('Protocol envelopes', () => {
  it('validates a generic request envelope', () => {
    const result = RequestEnvelopeSchema.safeParse({
      ...baseEnvelope,
      type: 'browser.navigate',
      payload: { url: 'https://example.com' },
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unsupported protocol version', () => {
    const result = BrowserRequestEnvelopeSchema.safeParse({
      ...baseEnvelope,
      version: '2.0',
      type: 'browser.list_tabs',
    });

    expect(result.success).toBe(false);
  });

  it('applies defaults for browser requests without payloads', () => {
    const result = BrowserRequestEnvelopeSchema.parse({
      ...baseEnvelope,
      type: 'browser.list_tabs',
    });

    expect(result.payload).toEqual({});
  });

  it('rejects unexpected payload fields at trust boundaries', () => {
    const result = BrowserRequestEnvelopeSchema.safeParse({
      ...baseEnvelope,
      type: 'browser.navigate',
      payload: {
        url: 'https://example.com',
        dangerous: true,
      },
    });

    expect(result.success).toBe(false);
  });

  it('validates element-targeted interaction requests', () => {
    const result = BrowserRequestEnvelopeSchema.safeParse({
      ...baseEnvelope,
      type: 'browser.type',
      payload: {
        tabId: 7,
        target: { elementId: 'e4' },
        text: 'hello',
      },
    });

    expect(result.success).toBe(true);
  });

  it('serializes success and error responses', () => {
    const success = createSuccessResponse({ ok: true }, baseEnvelope.id);
    const failure = createErrorResponse('PERMISSION_DENIED', 'Denied by policy', baseEnvelope.id);

    expect(ResponseEnvelopeSchema.safeParse(success).success).toBe(true);
    expect(ResponseEnvelopeSchema.safeParse(failure).success).toBe(true);
  });
});

describe('Confirmations', () => {
  it('validates expiring confirmation requests and user responses', () => {
    expect(
      ConfirmationRequestSchema.safeParse({
        id: baseEnvelope.id,
        requestId: '223e4567-e89b-12d3-a456-426614174000',
        operation: 'browser.navigate',
        risk: 'medium',
        summary: 'Approve example.com',
        domain: 'example.com',
        expiresAt: Date.now() + 60_000,
      }).success,
    ).toBe(true);
    expect(
      ConfirmationResponseSchema.safeParse({ confirmationId: baseEnvelope.id, approved: true })
        .success,
    ).toBe(true);
  });

  it('validates extension confirmation management messages', () => {
    expect(
      ExtensionManagementRequestSchema.safeParse({
        ...baseEnvelope,
        type: 'extension.confirmations.list',
        payload: {},
      }).success,
    ).toBe(true);
    expect(
      ExtensionManagementRequestSchema.safeParse({
        ...baseEnvelope,
        type: 'extension.confirmations.respond',
        payload: { confirmationId: baseEnvelope.id, approved: false },
      }).success,
    ).toBe(true);
    expect(
      ExtensionManagementRequestSchema.safeParse({
        ...baseEnvelope,
        type: 'extension.confirmations.respond',
        payload: { confirmationId: baseEnvelope.id, approved: 'yes' },
      }).success,
    ).toBe(false);
  });

  it('validates bounded extension audit requests and structured events', () => {
    expect(
      ExtensionManagementRequestSchema.safeParse({
        ...baseEnvelope,
        type: 'extension.audit.list',
        payload: { limit: 25 },
      }).success,
    ).toBe(true);
    expect(
      ExtensionManagementRequestSchema.safeParse({
        ...baseEnvelope,
        type: 'extension.audit.list',
        payload: { limit: 101 },
      }).success,
    ).toBe(false);
    expect(
      AuditEventSchema.safeParse({
        id: baseEnvelope.id,
        timestamp: baseEnvelope.timestamp,
        type: 'browser.action',
        outcome: 'success',
        operation: 'browser.snapshot',
        domain: 'example.com',
      }).success,
    ).toBe(true);
  });
});

describe('Remote device protocol', () => {
  it('accepts typed pairing permissions and rejects unknown escalation attempts', () => {
    const request = {
      code: 'ABCDEFG2',
      publicKey: 'A'.repeat(128),
      deviceName: 'Work laptop',
      requestedPermissions: ['browser.read'],
    };
    expect(PairingRequestSchema.safeParse(request).success).toBe(true);
    expect(
      PairingRequestSchema.safeParse({
        ...request,
        requestedPermissions: ['browser.root'],
      }).success,
    ).toBe(false);
  });

  it('validates signed challenge metadata at the trust boundary', () => {
    expect(
      RemoteAuthenticationSchema.safeParse({
        deviceId: baseEnvelope.id,
        challengeId: '223e4567-e89b-12d3-a456-426614174000',
        requestDigest: 'a'.repeat(64),
        signature: 'A'.repeat(128),
      }).success,
    ).toBe(true);
    expect(
      RemoteAuthenticationSchema.safeParse({
        deviceId: baseEnvelope.id,
        challengeId: 'not-a-uuid',
        requestDigest: 'not-a-digest',
        signature: 'invalid signature',
      }).success,
    ).toBe(false);
  });
});

describe('Page snapshots', () => {
  it('validates a structured snapshot with interactive elements', () => {
    const result = PageSnapshotSchema.safeParse({
      url: 'https://example.com',
      title: 'Example',
      loadingState: 'complete',
      mode: 'interactive',
      capturedAt: 1_720_000_000_000,
      visibleText: 'Example Domain',
      elements: [
        {
          elementId: 'e1',
          role: 'link',
          name: 'More information',
          tagName: 'a',
          disabled: false,
          href: 'https://www.iana.org/domains/example',
          bounds: { x: 10, y: 20, width: 100, height: 30 },
        },
      ],
      frames: [],
    });

    expect(result.success).toBe(true);
  });
});
