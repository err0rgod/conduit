import { describe, expect, it } from 'vitest';
import {
  BrowserRequestEnvelopeSchema,
  PageSnapshotSchema,
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
