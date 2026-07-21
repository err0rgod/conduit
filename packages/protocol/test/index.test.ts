import { describe, it, expect } from 'vitest';
import { RequestEnvelopeSchema, ResponseEnvelopeSchema } from '../src/index';

describe('Protocol Schemas', () => {
  it('validates a correct request envelope', () => {
    const data = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      timestamp: Date.now(),
      version: '1.0',
      type: 'navigate',
      payload: { url: 'https://example.com' },
    };
    const result = RequestEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects an invalid request envelope', () => {
    const data = {
      id: 'invalid-uuid',
      timestamp: Date.now(),
      version: '1.0',
      type: 'navigate',
      payload: {},
    };
    const result = RequestEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('validates a success response envelope', () => {
    const data = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      timestamp: Date.now(),
      version: '1.0',
      success: true,
      payload: { status: 'ok' },
    };
    const result = ResponseEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('validates an error response envelope', () => {
    const data = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      timestamp: Date.now(),
      version: '1.0',
      success: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: 'You cannot do this',
      },
    };
    const result = ResponseEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});
