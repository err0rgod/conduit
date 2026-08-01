import {
  BrowserRequestEnvelope,
  BrowserRequestEnvelopeSchema,
  ConfirmationRequest,
  ConfirmationRequestSchema,
  ResponseEnvelope,
  ResponseEnvelopeSchema,
  createEnvelopeBase,
} from '@conduit/protocol';
import { LocalAuth } from '@conduit/security';
import { PendingPairing, TrustedDevice } from '@conduit/security';

export interface ConduitClientOptions {
  baseUrl?: string;
  token?: string;
  auth?: LocalAuth;
  fetch?: typeof fetch;
}

export interface DaemonHealth {
  status: 'ok';
  extensionConnected: boolean;
  instanceId: string;
}

export interface BrowserRequestOptions {
  confirmationId?: string;
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
    options: BrowserRequestOptions = {},
  ): Promise<ResponseEnvelope> {
    const request = BrowserRequestEnvelopeSchema.parse({ ...createEnvelopeBase(), type, payload });
    return this.send(request, options);
  }

  public async send(
    request: BrowserRequestEnvelope,
    options: BrowserRequestOptions = {},
  ): Promise<ResponseEnvelope> {
    const response = await this.fetchImplementation(`${this.baseUrl}/api/action`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
        'Content-Type': 'application/json',
        ...(options.confirmationId ? { 'X-Conduit-Confirmation': options.confirmationId } : {}),
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

  public async listConfirmations(): Promise<ConfirmationRequest[]> {
    const response = await this.fetchImplementation(`${this.baseUrl}/api/confirmations`, {
      headers: { Authorization: `Bearer ${this.getToken()}` },
    });
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null || !('confirmations' in value)) {
      throw new ConduitClientError('Daemon returned an invalid confirmation list.');
    }
    const parsed = ConfirmationRequestSchema.array().safeParse(value.confirmations);
    if (!parsed.success) throw new ConduitClientError('Daemon returned invalid confirmations.');
    return parsed.data;
  }

  public async respondToConfirmation(confirmationId: string, approved: boolean): Promise<boolean> {
    const response = await this.fetchImplementation(`${this.baseUrl}/api/confirmations/respond`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmationId, approved }),
    });
    const value: unknown = await response.json();
    return (
      response.ok &&
      typeof value === 'object' &&
      value !== null &&
      'accepted' in value &&
      value.accepted === true
    );
  }

  public async startPairing(): Promise<{ code: string; expiresAt: number }> {
    return this.authorizedJson('/api/pairings/start', { method: 'POST', body: '{}' });
  }

  public async listPairings(): Promise<PendingPairing[]> {
    const value = await this.authorizedJson<unknown>('/api/pairings');
    if (!isRecord(value) || !Array.isArray(value.pairings)) {
      throw new ConduitClientError('Daemon returned an invalid pairing list.');
    }
    return value.pairings as PendingPairing[];
  }

  public async respondToPairing(
    pairingId: string,
    approved: boolean,
    grantedPermissions: string[] = [],
  ): Promise<unknown> {
    return this.authorizedJson('/api/pairings/respond', {
      method: 'POST',
      body: JSON.stringify({ pairingId, approved, grantedPermissions }),
    });
  }

  public async listDevices(): Promise<TrustedDevice[]> {
    const value = await this.authorizedJson<unknown>('/api/devices');
    if (!isRecord(value) || !Array.isArray(value.devices)) {
      throw new ConduitClientError('Daemon returned an invalid trusted-device list.');
    }
    return value.devices as TrustedDevice[];
  }

  public async revokeDevice(deviceId: string): Promise<boolean> {
    const value = await this.authorizedJson<unknown>('/api/devices/revoke', {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    });
    return isRecord(value) && value.revoked === true;
  }

  public async shutdown(): Promise<boolean> {
    const value = await this.authorizedJson<unknown>('/api/shutdown', {
      method: 'POST',
      body: '{}',
    });
    return isRecord(value) && value.stopping === true;
  }

  private async authorizedJson<T>(
    endpoint: string,
    options: { method?: string; body?: string } = {},
  ): Promise<T> {
    const response = await this.fetchImplementation(`${this.baseUrl}${endpoint}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body ? { body: options.body } : {}),
    });
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ConduitClientError(`Daemon returned a non-JSON HTTP ${response.status} response.`);
    }
    if (!response.ok) {
      const message =
        isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string'
          ? value.error.message
          : `Daemon request failed with HTTP ${response.status}.`;
      throw new ConduitClientError(message);
    }
    return value as T;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDaemonHealth(value: unknown): value is DaemonHealth {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'ok' &&
    'extensionConnected' in value &&
    typeof value.extensionConnected === 'boolean' &&
    'instanceId' in value &&
    typeof value.instanceId === 'string'
  );
}
