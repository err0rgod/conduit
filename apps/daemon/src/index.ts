import * as http from 'http';
import {
  AuthMessageSchema,
  BrowserRequestEnvelopeSchema,
  ResponseEnvelope,
  ResponseEnvelopeSchema,
  createErrorResponse,
  createSuccessResponse,
} from '@conduit/protocol';
import { LocalAuth } from '@conduit/security';
import { WebSocket, WebSocketServer } from 'ws';

export interface DaemonOptions {
  auth?: LocalAuth;
  requestTimeoutMs?: number;
  maxBodyBytes?: number;
}

interface PendingRequest {
  resolve: (response: ResponseEnvelope) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 1_048_576;

export class Daemon {
  private readonly auth: LocalAuth;
  private readonly requestTimeoutMs: number;
  private readonly maxBodyBytes: number;
  private activeExtension: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;

  public constructor(options: DaemonOptions = {}) {
    this.auth = options.auth ?? new LocalAuth();
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  public async start(port = 0): Promise<number> {
    this.server = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => this.handleExtensionConnection(ws));

    return new Promise((resolve) => {
      this.server?.listen(port, '127.0.0.1', () => {
        const address = this.server?.address();
        resolve(typeof address === 'string' || !address ? 0 : address.port);
      });
    });
  }

  public async stop(): Promise<void> {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingRequests.clear();

    this.wss?.clients.forEach((client) => client.close());

    await Promise.all([
      new Promise<void>((resolve) => {
        if (!this.wss) {
          resolve();
          return;
        }
        this.wss.close(() => resolve());
      }),
      new Promise<void>((resolve) => {
        if (!this.server) {
          resolve();
          return;
        }
        this.server.close(() => resolve());
      }),
    ]);

    this.activeExtension = null;
    this.wss = null;
    this.server = null;
  }

  public getToken(): string {
    return this.auth.ensureToken();
  }

  public isExtensionConnected(): boolean {
    return this.activeExtension?.readyState === WebSocket.OPEN;
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (req.method === 'GET' && req.url === '/health') {
      this.writeJson(res, 200, {
        status: 'ok',
        extensionConnected: this.isExtensionConnected(),
      });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/api/action') {
      this.writeJson(res, 404, createErrorResponse('INVALID_REQUEST', 'Unknown daemon endpoint.'));
      return;
    }

    if (!this.isAuthorizedHttpRequest(req)) {
      this.writeJson(
        res,
        401,
        createErrorResponse('AUTHENTICATION_REQUIRED', 'A valid Conduit local token is required.'),
      );
      return;
    }

    const body = await this.readBody(req);
    if (!body.ok) {
      this.writeJson(res, body.status, body.response);
      return;
    }

    const request = BrowserRequestEnvelopeSchema.safeParse(body.value);
    if (!request.success) {
      this.writeJson(
        res,
        400,
        createErrorResponse(
          'INVALID_REQUEST',
          'Browser request failed protocol validation.',
          undefined,
          {
            issues: request.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        ),
      );
      return;
    }

    if (!this.isExtensionConnected() || !this.activeExtension) {
      this.writeJson(
        res,
        503,
        createErrorResponse(
          'EXTENSION_DISCONNECTED',
          'No authenticated browser extension is connected.',
        ),
      );
      return;
    }

    const response = await this.forwardToExtension(request.data);
    this.writeJson(res, response.success ? 200 : 502, response);
  }

  private handleExtensionConnection(ws: WebSocket): void {
    let authenticated = false;

    ws.on('message', (data) => {
      const parsed = this.parseJson(data.toString());
      if (!parsed.ok) {
        ws.send(
          JSON.stringify(createErrorResponse('INVALID_REQUEST', 'Message was not valid JSON.')),
        );
        return;
      }

      if (!authenticated) {
        const authMessage = AuthMessageSchema.safeParse(parsed.value);
        if (authMessage.success && this.auth.verifyToken(authMessage.data.payload.token)) {
          authenticated = true;
          this.activeExtension = ws;
          ws.send(JSON.stringify({ type: 'auth_success' }));
          return;
        }

        ws.send(
          JSON.stringify({
            type: 'error',
            error: { code: 'AUTHENTICATION_FAILED', message: 'Extension authentication failed.' },
          }),
        );
        ws.close();
        return;
      }

      const response = ResponseEnvelopeSchema.safeParse(parsed.value);
      if (!response.success) {
        ws.send(
          JSON.stringify(createErrorResponse('INVALID_REQUEST', 'Extension response was invalid.')),
        );
        return;
      }

      const correlationId = response.data.correlationId;
      if (!correlationId) {
        return;
      }

      const pending = this.pendingRequests.get(correlationId);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timer);
      this.pendingRequests.delete(correlationId);
      pending.resolve(response.data);
    });

    ws.on('close', () => {
      if (this.activeExtension === ws) {
        this.activeExtension = null;
      }
    });
  }

  private forwardToExtension(request: unknown): Promise<ResponseEnvelope> {
    if (!this.activeExtension || this.activeExtension.readyState !== WebSocket.OPEN) {
      return Promise.resolve(
        createErrorResponse(
          'EXTENSION_DISCONNECTED',
          'No authenticated browser extension is connected.',
        ),
      );
    }

    const requestId = BrowserRequestEnvelopeSchema.parse(request).id;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve(
          createErrorResponse(
            'ACTION_TIMEOUT',
            'Browser extension did not respond before timeout.',
            requestId,
          ),
        );
      }, this.requestTimeoutMs);

      this.pendingRequests.set(requestId, { resolve, timer });
      this.activeExtension?.send(JSON.stringify(request));
    });
  }

  private isAuthorizedHttpRequest(req: http.IncomingMessage): boolean {
    const authorization = req.headers.authorization;
    const bearerToken =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : undefined;
    const headerToken = req.headers['x-conduit-token'];
    const token = bearerToken ?? (typeof headerToken === 'string' ? headerToken : undefined);

    return typeof token === 'string' && this.auth.verifyToken(token);
  }

  private async readBody(req: http.IncomingMessage): Promise<
    | { ok: true; value: unknown }
    | {
        ok: false;
        status: number;
        response: ResponseEnvelope;
      }
  > {
    let body = '';

    for await (const chunk of req) {
      body += chunk.toString();
      if (Buffer.byteLength(body) > this.maxBodyBytes) {
        return {
          ok: false,
          status: 413,
          response: createErrorResponse(
            'PAYLOAD_TOO_LARGE',
            'Request payload exceeded daemon size limit.',
          ),
        };
      }
    }

    const parsed = this.parseJson(body);
    if (!parsed.ok) {
      return {
        ok: false,
        status: 400,
        response: createErrorResponse('INVALID_REQUEST', 'Request body was not valid JSON.'),
      };
    }

    return { ok: true, value: parsed.value };
  }

  private parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
    try {
      return { ok: true, value: JSON.parse(value) };
    } catch {
      return { ok: false };
    }
  }

  private writeJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

if (require.main === module) {
  const daemon = new Daemon();
  daemon.start(9222).then((port) => {
    console.log(`Conduit daemon started on 127.0.0.1:${port}`);
    console.log(`Local token: ${daemon.getToken()}`);
  });

  process.on('SIGINT', () => {
    void daemon.stop().then(() => process.exit(0));
  });
}
