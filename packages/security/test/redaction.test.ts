import { describe, expect, it } from 'vitest';
import { redact, redactString } from '../src/audit';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const BASE64 = 'Zm9vYmFyU2VjcmV0VmFsdWVXaXRoTWl4ZWRDYXNlMTIzNDU2Nzg5MEFCQ0RFRg';

describe('string redaction', () => {
  it.each([
    ['JWT alone', JWT, '[redacted]'],
    ['JWT in sentence', `session ${JWT} was refreshed`, 'session [redacted] was refreshed'],
    ['unsigned JWT', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.', '[redacted]'],
    [
      'bearer token',
      'Authorization failed for Bearer abc123.def-456_ghi',
      'Authorization failed for Bearer [redacted]',
    ],
    ['lowercase bearer', 'sent bearer sk_live_abcdef123456', 'sent bearer [redacted]'],
    ['basic auth header', 'Basic dXNlcjpwYXNzd29yZA==', 'Basic [redacted]'],
    ['long base64', `value=${BASE64}`, 'value=[redacted]'],
    ['long base64 in text', `key ${BASE64} leaked`, 'key [redacted] leaked'],
    ['padded base64', `${BASE64}==`, '[redacted]'],
    [
      'URL credentials',
      'open https://alice:s3cret@example.com/path',
      'open https://[redacted]@example.com/path',
    ],
    ['URL credentials ftp', 'ftp://bob:pw@host.test/f', 'ftp://[redacted]@host.test/f'],
    [
      'token query',
      'GET https://a.test/cb?token=abc123&x=1',
      'GET https://a.test/cb?token=[redacted]&x=1',
    ],
    [
      'access_token query',
      'https://a.test/?access_token=abc.def',
      'https://a.test/?access_token=[redacted]',
    ],
    [
      'api_key query',
      'https://a.test/?a=1&api_key=K3Y&b=2',
      'https://a.test/?a=1&api_key=[redacted]&b=2',
    ],
    ['key query', 'https://maps.test/?key=AIza123', 'https://maps.test/?key=[redacted]'],
    ['sig query', 'https://cdn.test/f?sig=deadbeef', 'https://cdn.test/f?sig=[redacted]'],
    [
      'signature query',
      'https://s3.test/f?X-Amz-Signature=abc',
      'https://s3.test/f?X-Amz-Signature=[redacted]',
    ],
    [
      'code query',
      'https://auth.test/cb?code=4/0AbC&state=zz',
      'https://auth.test/cb?code=[redacted]&state=zz',
    ],
    [
      'password query',
      'https://a.test/login?user=u&password=hunter2',
      'https://a.test/login?user=u&password=[redacted]',
    ],
    ['session query', 'https://a.test/?session=abc', 'https://a.test/?session=[redacted]'],
    ['auth query', 'https://a.test/?auth=abc', 'https://a.test/?auth=[redacted]'],
    [
      'prefixed secret',
      'https://a.test/?client_secret=abc',
      'https://a.test/?client_secret=[redacted]',
    ],
    ['uppercase param', 'https://a.test/?TOKEN=abc', 'https://a.test/?TOKEN=[redacted]'],
    [
      'fragment token',
      'https://a.test/#access_token=abc&type=bearer',
      'https://a.test/#access_token=[redacted]&type=bearer',
    ],
    [
      'quoted URL',
      'navigate "https://a.test/?token=abc" failed',
      'navigate "https://a.test/?token=[redacted]" failed',
    ],
    ['existing hex token', `token ${'a1'.repeat(20)}`, 'token [redacted]'],
  ])('redacts %s', (_name, input, expected) => {
    expect(redactString(input)).toBe(expected);
  });

  it.each([
    ['plain sentence', 'Navigation to the settings page completed'],
    ['simple URL', 'https://example.com/docs/getting-started?page=2&lang=en'],
    ['URL with port', 'http://localhost:9222/health'],
    ['URL with user only', 'https://user@example.com/path'],
    ['keyboard parameter', 'https://a.test/?keyboard=qwerty&codec=h264&monkey=1'],
    ['hash-like short word', 'https://a.test/?sort=asc#section-2'],
    ['UUID', '123e4567-e89b-12d3-a456-426614174000'],
    [
      'long lowercase slug',
      'https://blog.test/my-very-long-hyphenated-article-title-about-many-things',
    ],
    [
      'long camelCase identifier',
      'getElementByIdAndSomethingElseVeryLongFunctionNameWithoutDigits',
    ],
    [
      'long file path',
      'C:/Users/someone/Documents/projects/conduit/packages/security/src/audit.ts',
    ],
    ['version string', 'conduit 1.1.4 on node v20.19.0'],
    ['short base64', 'dXNlcjpwYXNz'],
    ['word Bearer alone', 'Bearer tokens are not logged'],
    ['code in prose', 'the code= parameter is documented'],
  ])('leaves %s unchanged', (_name, input) => {
    expect(redactString(input)).toBe(input);
  });

  it('is idempotent', () => {
    const once = redactString(`${JWT} https://a:b@c.test/?token=x`);
    expect(redactString(once)).toBe(once);
  });

  it('applies string rules to nested object values and arrays', () => {
    expect(
      redact({
        message: `failed https://a.test/cb?token=abc with ${JWT}`,
        list: ['https://u:p@h.test', 'fine'],
        deep: { note: 'Bearer abcdefghijkl' },
        count: 3,
      }),
    ).toEqual({
      message: 'failed https://a.test/cb?token=[redacted] with [redacted]',
      list: ['https://[redacted]@h.test', 'fine'],
      deep: { note: 'Bearer [redacted]' },
      count: 3,
    });
  });

  it('handles pathological input quickly', () => {
    const started = Date.now();
    redactString('a'.repeat(200_000));
    redactString('?token'.repeat(20_000));
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
