import { describe, expect, it } from 'vitest';
import { BrowserActionError, normalizeDataUrl } from '../src/index';

describe('browser-core screenshot helpers', () => {
  it('normalizes PNG data URLs into protocol screenshot results', () => {
    const result = normalizeDataUrl('data:image/png;base64,aGVsbG8=');

    expect(result).toEqual({
      mimeType: 'image/png',
      data: 'aGVsbG8=',
    });
  });

  it('rejects unsupported screenshot data URL formats', () => {
    expect(() => normalizeDataUrl('data:text/plain;base64,aGVsbG8=')).toThrow(BrowserActionError);
  });
});
