import * as http from 'http';
import {
  AuthMessageSchema,
  BrowserRequestEnvelopeSchema,
  ConfirmationResponseSchema,
  ResponseEnvelope,
  ResponseEnvelopeSchema,
  createErrorResponse,
  createSuccessResponse,
} from '@conduit/protocol';
import {
  AuditLogger,
  ConfirmationManager,
  FileAccessError,
  LocalAuth,
  SecurityPolicy,
  SlidingWindowRateLimiter,
  validateUploadPaths,
} from '@conduit/security';
import { WebSocket, WebSocketServer } from 'ws';

export interface DaemonOptions {
  auth?: Authenticator;
  requestTimeoutMs?: number;
  maxBodyBytes?: number;
  policy?: SecurityPolicy;
  confirmations?: ConfirmationManager;
  audit?: AuditLogger;
  uploadAllowlist?: string[];
  maxUploadFileBytes?: number;
  authenticationTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  sessionTimeoutMs?: number;
  maximumPendingRequests?: number;
  duplicateRequestWindowMs?: number;
  maximumAuthenticationFailures?: number;
  authenticationFailureWindowMs?: number;
}

export interface Authenticator {
  ensureToken(): string;
  verifyToken(token: string): boolean;
}

interface PendingRequest {
  resolve: (response: ResponseEnvelope) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const DEFAULT_AUTHENTICATION_TIMEOUT_MS = 5_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAXIMUM_PENDING_REQUESTS = 100;
const DEFAULT_DUPLICATE_REQUEST_WINDOW_MS = 60_000;

export class Daemon {
  private readonly auth: Authenticator;
  private readonly requestTimeoutMs: number;
  private readonly maxBodyBytes: number;
  private readonly policy: SecurityPolicy;
  private readonly confirmations: ConfirmationManager;
  private readonly audit: AuditLogger;
  private readonly uploadAllowlist: string[];
  private readonly maxUploadFileBytes: number;
  private readonly authenticationTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly sessionTimeoutMs: number;
  private readonly maximumPendingRequests: number;
  private readonly duplicateRequestWindowMs: number;
  private readonly authenticationFailures: SlidingWindowRateLimiter;
  private readonly tabUrls = new Map<number, string>();
  private activeTabId: number | null = null;
  private activeExtension: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private readonly recentRequestIds = new Map<string, number>();
  private readonly lastExtensionActivity = new WeakMap<WebSocket, number>();
  private readonly extensionSessionStartedAt = new WeakMap<WebSocket, number>();
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  public constructor(options: DaemonOptions = {}) {
    this.auth = options.auth ?? new LocalAuth();
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.policy = options.policy ?? new SecurityPolicy();
    this.confirmations = options.confirmations ?? new ConfirmationManager();
    this.audit = options.audit ?? new AuditLogger();
    this.uploadAllowlist = options.uploadAllowlist ?? [];
    this.maxUploadFileBytes = options.maxUploadFileBytes ?? 10 * 1024 * 1024;
    this.authenticationTimeoutMs =
      options.authenticationTimeoutMs ?? DEFAULT_AUTHENTICATION_TIMEOUT_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.maximumPendingRequests =
      options.maximumPendingRequests ?? DEFAULT_MAXIMUM_PENDING_REQUESTS;
    this.duplicateRequestWindowMs =
      options.duplicateRequestWindowMs ?? DEFAULT_DUPLICATE_REQUEST_WINDOW_MS;
    this.authenticationFailures = new SlidingWindowRateLimiter(
      options.maximumAuthenticationFailures ?? 5,
      options.authenticationFailureWindowMs ?? 60_000,
    );
  }

  public async start(port = 0): Promise<number> {
    if (this.server) throw new Error('Conduit daemon is already running.');
    const server = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });
    this.server = server;
    server.on('error', (error) => {
      this.audit.log({
        type: 'daemon.error',
        outcome: 'failure',
        details: { message: error.message },
      });
    });

    server.requestTimeout = this.requestTimeoutMs + 5_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;

    return new Promise((resolve, reject) => {
      const handleStartupError = (error: Error): void => {
        server.off('listening', handleListening);
        this.server = null;
        reject(error);
      };
      const handleListening = (): void => {
        server.off('error', handleStartupError);
        this.wss = new WebSocketServer({ server, maxPayload: this.maxBodyBytes });
        this.wss.on('connection', (ws, request) =>
          this.handleExtensionConnection(ws, request.socket.remoteAddress ?? 'unknown'),
        );
        this.wss.on('error', (error) => {
          this.audit.log({
            type: 'daemon.websocket',
            outcome: 'failure',
            details: { message: error.message },
          });
        });
        this.heartbeatTimer = setInterval(
          () => this.checkExtensionSessions(),
          this.heartbeatIntervalMs,
        );
        this.heartbeatTimer.unref();
        const address = server.address();
        this.audit.log({ type: 'daemon.start', outcome: 'success' });
        resolve(typeof address === 'string' || !address ? 0 : address.port);
      };
      server.once('error', handleStartupError);
      server.once('listening', handleListening);
      server.listen(port, '127.0.0.1');
    });
  }

  public async stop(): Promise<void> {
    this.audit.log({ type: 'daemon.stop', outcome: 'success' });
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.resolve(
        createErrorResponse('DAEMON_UNAVAILABLE', 'Conduit daemon is shutting down.', requestId),
      );
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
    this.recentRequestIds.clear();
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

    const isAction = req.method === 'POST' && req.url === '/api/action';
    const isConfirmationList = req.method === 'GET' && req.url === '/api/confirmations';
    const isConfirmationResponse =
      req.method === 'POST' && req.url === '/api/confirmations/respond';
    if (!isAction && !isConfirmationList && !isConfirmationResponse) {
      this.writeJson(res, 404, createErrorResponse('INVALID_REQUEST', 'Unknown daemon endpoint.'));
      return;
    }

    const clientKey = `http:${req.socket.remoteAddress ?? 'unknown'}`;
    if (!this.isAuthorizedHttpRequest(req)) {
      this.audit.log({ type: 'client.authentication', outcome: 'denied' });
      const rateLimit = this.authenticationFailures.attempt(clientKey);
      this.writeJson(
        res,
        rateLimit.allowed ? 401 : 429,
        rateLimit.allowed
          ? createErrorResponse(
              'AUTHENTICATION_REQUIRED',
              'A valid Conduit local token is required.',
            )
          : createErrorResponse(
              'RATE_LIMITED',
              'Too many failed authentication attempts. Try again later.',
              undefined,
              { retryAfterMs: rateLimit.retryAfterMs },
            ),
      );
      return;
    }
    this.authenticationFailures.reset(clientKey);

    if (isConfirmationList) {
      this.writeJson(res, 200, { confirmations: this.confirmations.list() });
      return;
    }

    if (isConfirmationResponse) {
      await this.handleConfirmationResponse(req, res);
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

    let browserRequest = request.data;
    if (browserRequest.type === 'browser.upload_file') {
      try {
        browserRequest = {
          ...browserRequest,
          payload: {
            ...browserRequest.payload,
            files: validateUploadPaths(
              browserRequest.payload.files,
              this.uploadAllowlist,
              this.maxUploadFileBytes,
            ),
          },
        };
      } catch (error) {
        const message =
          error instanceof FileAccessError ? error.message : 'Upload path validation failed.';
        this.audit.log({
          type: 'file.upload',
          outcome: 'denied',
          requestId: browserRequest.id,
          operation: browserRequest.type,
          details: { reason: message },
        });
        this.writeJson(
          res,
          403,
          createErrorResponse('FILE_ACCESS_DENIED', message, browserRequest.id),
        );
        return;
      }
    }

    const decision = this.policy.authorize(browserRequest, this.currentUrlFor(browserRequest));
    if (decision.outcome === 'deny') {
      this.audit.log({
        type: 'permission.decision',
        outcome: 'denied',
        requestId: browserRequest.id,
        operation: browserRequest.type,
        domain: decision.domain,
        details: { permission: decision.permission, reason: decision.reason },
      });
      this.writeJson(
        res,
        403,
        createErrorResponse(
          decision.domain ? 'DOMAIN_NOT_ALLOWED' : 'PERMISSION_DENIED',
          decision.reason,
          browserRequest.id,
        ),
      );
      return;
    }

    if (decision.outcome === 'confirm') {
      const header = req.headers['x-conduit-confirmation'];
      const confirmationId = typeof header === 'string' ? header : '';
      if (!this.confirmations.consume(confirmationId, browserRequest.type)) {
        const confirmation = this.confirmations.create(
          browserRequest.id,
          browserRequest.type,
          decision.risk,
          decision.reason,
          decision.domain,
        );
        this.audit.log({
          type: 'confirmation.requested',
          outcome: 'pending',
          requestId: browserRequest.id,
          operation: browserRequest.type,
          domain: decision.domain,
        });
        this.writeJson(
          res,
          409,
          createErrorResponse('USER_CONFIRMATION_REQUIRED', decision.reason, browserRequest.id, {
            confirmation,
          }),
        );
        return;
      }
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

    this.pruneRecentRequestIds();
    if (
      this.pendingRequests.has(browserRequest.id) ||
      this.recentRequestIds.has(browserRequest.id)
    ) {
      this.writeJson(
        res,
        409,
        createErrorResponse(
          'INVALID_REQUEST',
          'The request ID has already been used recently.',
          browserRequest.id,
        ),
      );
      return;
    }
    if (this.pendingRequests.size >= this.maximumPendingRequests) {
      this.writeJson(
        res,
        429,
        createErrorResponse(
          'RATE_LIMITED',
          'The daemon browser-action queue is full.',
          browserRequest.id,
        ),
      );
      return;
    }

    const response = await this.forwardToExtension(browserRequest);
    this.recordBrowserState(browserRequest, response);
    this.audit.log({
      type: 'browser.action',
      outcome: response.success ? 'success' : 'failure',
      requestId: browserRequest.id,
      correlationId: response.correlationId,
      operation: browserRequest.type,
      domain: decision.domain,
      ...(!response.success ? { details: { errorCode: response.error.code } } : {}),
    });
    this.writeJson(res, response.success ? 200 : 502, response);
  }

  private handleExtensionConnection(ws: WebSocket, remoteAddress: string): void {
    let authenticated = false;
    const clientKey = `ws:${remoteAddress}`;
    const authenticationTimer = setTimeout(() => {
      if (!authenticated) ws.close(4001, 'Authentication timeout');
    }, this.authenticationTimeoutMs);
    authenticationTimer.unref();
    this.lastExtensionActivity.set(ws, Date.now());

    ws.on('pong', () => this.lastExtensionActivity.set(ws, Date.now()));
    ws.on('error', (error) => {
      this.audit.log({
        type: 'extension.transport',
        outcome: 'failure',
        details: { message: error.message },
      });
    });

    ws.on('message', (data) => {
      this.lastExtensionActivity.set(ws, Date.now());
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
          clearTimeout(authenticationTimer);
          this.authenticationFailures.reset(clientKey);
          this.extensionSessionStartedAt.set(ws, Date.now());
          if (this.activeExtension && this.activeExtension !== ws) {
            this.activeExtension.close(4002, 'Replaced by a newer authenticated extension');
          }
          this.activeExtension = ws;
          ws.send(JSON.stringify({ type: 'auth_success' }));
          this.audit.log({ type: 'extension.authentication', outcome: 'success' });
          return;
        }

        const rateLimit = this.authenticationFailures.attempt(clientKey);
        ws.send(
          JSON.stringify(
            rateLimit.allowed
              ? {
                  type: 'error',
                  error: {
                    code: 'AUTHENTICATION_FAILED',
                    message: 'Extension authentication failed.',
                  },
                }
              : createErrorResponse(
                  'RATE_LIMITED',
                  'Too many failed authentication attempts. Try again later.',
                ),
          ),
        );
        ws.close();
        this.audit.log({ type: 'extension.authentication', outcome: 'denied' });
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
      clearTimeout(authenticationTimer);
      if (this.activeExtension === ws) {
        this.activeExtension = null;
        this.audit.log({ type: 'extension.disconnected', outcome: 'success' });
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
    this.recentRequestIds.set(requestId, Date.now() + this.duplicateRequestWindowMs);

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

  private checkExtensionSessions(): void {
    const now = Date.now();
    this.wss?.clients.forEach((client) => {
      const lastActivity = this.lastExtensionActivity.get(client) ?? now;
      const sessionStartedAt = this.extensionSessionStartedAt.get(client);
      if (
        now - lastActivity > this.sessionTimeoutMs ||
        (sessionStartedAt !== undefined && now - sessionStartedAt > this.sessionTimeoutMs)
      ) {
        client.close(4003, 'Session expired');
        return;
      }
      if (client.readyState === WebSocket.OPEN) client.ping();
    });
    this.pruneRecentRequestIds(now);
  }

  private pruneRecentRequestIds(now = Date.now()): void {
    for (const [requestId, expiresAt] of this.recentRequestIds) {
      if (expiresAt <= now) this.recentRequestIds.delete(requestId);
    }
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

  private async handleConfirmationResponse(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    if (!body.ok) {
      this.writeJson(res, body.status, body.response);
      return;
    }
    const parsed = ConfirmationResponseSchema.safeParse(body.value);
    if (!parsed.success) {
      this.writeJson(
        res,
        400,
        createErrorResponse('INVALID_REQUEST', 'Invalid confirmation response.'),
      );
      return;
    }
    const accepted = this.confirmations.respond(parsed.data.confirmationId, parsed.data.approved);
    this.audit.log({
      type: 'confirmation.responded',
      outcome: accepted && parsed.data.approved ? 'success' : 'denied',
      details: { confirmationId: parsed.data.confirmationId, approved: parsed.data.approved },
    });
    this.writeJson(res, accepted ? 200 : 404, { accepted });
  }

  private currentUrlFor(
    request: ReturnType<typeof BrowserRequestEnvelopeSchema.parse>,
  ): string | undefined {
    if (request.type === 'browser.navigate' || request.type === 'browser.open_tab')
      return undefined;
    const payload = request.payload as { tabId?: number };
    const tabId = payload.tabId ?? this.activeTabId ?? undefined;
    return tabId === undefined ? undefined : this.tabUrls.get(tabId);
  }

  private recordBrowserState(
    request: ReturnType<typeof BrowserRequestEnvelopeSchema.parse>,
    response: ResponseEnvelope,
  ): void {
    if (!response.success || typeof response.payload !== 'object' || response.payload === null)
      return;
    const payload = response.payload as {
      tab?: { id?: unknown; url?: unknown; active?: unknown } | null;
      tabs?: Array<{ id?: unknown; url?: unknown; active?: unknown }>;
    };
    const tabs = payload.tabs ?? (payload.tab ? [payload.tab] : []);
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') continue;
      if (typeof tab.url === 'string') this.tabUrls.set(tab.id, tab.url);
      if (tab.active === true) this.activeTabId = tab.id;
    }
    if (request.type === 'browser.navigate') {
      const responseTabId = typeof payload.tab?.id === 'number' ? payload.tab.id : undefined;
      const tabId = request.payload.tabId ?? responseTabId ?? this.activeTabId ?? undefined;
      if (tabId !== undefined) this.tabUrls.set(tabId, request.payload.url);
    }
    if (request.type === 'browser.close_tab') this.tabUrls.delete(request.payload.tabId);
    if (request.type === 'browser.focus_tab') this.activeTabId = request.payload.tabId;
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
    console.log('Local authentication initialized; token values are never printed.');
  });

  process.on('SIGINT', () => {
    void daemon.stop().then(() => process.exit(0));
  });
}
