import {
  BrowserRequestEnvelope,
  BrowserRequestEnvelopeSchema,
  ResponseEnvelope,
  ResponseEnvelopeSchema,
  createEnvelopeBase,
} from '@conduit/protocol';
import { LocalAuth } from '@conduit/security';

export interface ConduitClientOptions {
  baseUrl?: string;
  token?: string;
  auth?: LocalAuth;
  fetch?: typeof fetch;
}

export interface DaemonHealth {
  status: 'ok';
  extensionConnected: boolean;
}

export class ConduitClientError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConduitClientError';
  }
}

export class ConduitClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly getToken: () => string;

  public constructor(options: ConduitClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:9222').replace(/\/$/u, '');
    this.fetchImplementation = options.fetch ?? fetch;
    const auth = options.auth ?? new LocalAuth();
    this.getToken = options.token ? () => options.token as string : () => auth.ensureToken();
  }

  public async health(): Promise<DaemonHealth> {
    const response = await this.fetchImplementation(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new ConduitClientError(`Daemon health check failed with HTTP ${response.status}.`);
    }
    const value: unknown = await response.json();
    if (!isDaemonHealth(value)) {
      throw new ConduitClientError('Daemon returned an invalid health response.');
    }
    return value;
  }

  public async browser(
    type: BrowserRequestEnvelope['type'],
    payload: unknown = {},
  ): Promise<ResponseEnvelope> {
    const request = BrowserRequestEnvelopeSchema.parse({ ...createEnvelopeBase(), type, payload });
    return this.send(request);
  }

  public async send(request: BrowserRequestEnvelope): Promise<ResponseEnvelope> {
    const response = await this.fetchImplementation(`${this.baseUrl}/api/action`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ConduitClientError(`Daemon returned a non-JSON HTTP ${response.status} response.`);
    }
    const parsed = ResponseEnvelopeSchema.safeParse(value);
    if (!parsed.success) {
      throw new ConduitClientError('Daemon response failed protocol validation.');
    }
    return parsed.data;
  }
}

function isDaemonHealth(value: unknown): value is DaemonHealth {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'ok' &&
    'extensionConnected' in value &&
    typeof value.extensionConnected === 'boolean'
  );
}
