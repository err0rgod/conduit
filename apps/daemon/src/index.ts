import * as http from 'http';
import * as https from 'https';
import * as crypto from 'node:crypto';
import {
  AuthMessageSchema,
  BrowserRequestEnvelopeSchema,
  ConfirmationResponseSchema,
  DeviceRevocationRequestSchema,
  ExtensionPairingRequestSchema,
  PairingDecisionSchema,
  PairingRequestSchema,
  Permission,
  RemoteAuthenticationSchema,
  RemoteChallengeRequestSchema,
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
  LocalPairingManager,
  PairingError,
  PairingManager,
  RemoteDeviceAuthenticator,
  SecurityPolicy,
  SlidingWindowRateLimiter,
  TrustedDeviceStore,
  digestRemoteRequest,
  requiredPermissionFor,
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
  bindAddress?: string;
  remoteEnabled?: boolean;
  tls?: https.ServerOptions;
  devices?: TrustedDeviceStore;
  pairing?: PairingManager;
  remoteAuthenticator?: RemoteDeviceAuthenticator;
  remoteSessionTimeoutMs?: number;
  maximumRemoteRequests?: number;
  remoteRequestWindowMs?: number;
  instanceId?: string;
  shutdownHandler?: () => void;
  localPairing?: LocalPairingManager;
}

export interface Authenticator {
  ensureToken(): string;
  verifyToken(token: string): boolean;
}

interface PendingRequest {
  resolve: (response: ResponseEnvelope) => void;
  timer: NodeJS.Timeout;
}

type ClientAuthorization =
  { kind: 'local' } | { kind: 'remote'; deviceId: string; permissions: Permission[] };

interface RemoteSession {
  deviceId: string;
  permissions: Permission[];
  expiresAt: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
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
  private readonly bindAddress: string;
  private readonly remoteEnabled: boolean;
  private readonly tls?: https.ServerOptions;
  private readonly devices: TrustedDeviceStore;
  private readonly pairing: PairingManager;
  private readonly remoteAuthenticator: RemoteDeviceAuthenticator;
  private readonly remoteSessionTimeoutMs: number;
  private readonly remoteRequestLimits: SlidingWindowRateLimiter;
  private readonly instanceId: string;
  private readonly shutdownHandler?: () => void;
  private readonly localPairing: LocalPairingManager;
  private readonly localPairingAttempts: SlidingWindowRateLimiter;
  private readonly tabUrls = new Map<number, string>();
  private activeTabId: number | null = null;
  private activeExtension: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private readonly recentRequestIds = new Map<string, number>();
  private readonly lastExtensionActivity = new WeakMap<WebSocket, number>();
  private readonly extensionSessionStartedAt = new WeakMap<WebSocket, number>();
  private readonly remoteSessions = new Map<string, RemoteSession>();
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
    this.bindAddress = options.bindAddress ?? '127.0.0.1';
    this.remoteEnabled = options.remoteEnabled ?? false;
    this.tls = options.tls;
    this.devices = options.devices ?? new TrustedDeviceStore();
    this.pairing = options.pairing ?? new PairingManager(this.devices);
    this.remoteAuthenticator =
      options.remoteAuthenticator ?? new RemoteDeviceAuthenticator(this.devices);
    this.remoteSessionTimeoutMs = options.remoteSessionTimeoutMs ?? 15 * 60_000;
    this.remoteRequestLimits = new SlidingWindowRateLimiter(
      options.maximumRemoteRequests ?? 120,
      options.remoteRequestWindowMs ?? 60_000,
    );
    this.instanceId = options.instanceId ?? crypto.randomUUID();
    this.shutdownHandler = options.shutdownHandler;
    this.localPairing = options.localPairing ?? new LocalPairingManager();
    this.localPairingAttempts = new SlidingWindowRateLimiter(5, 60_000);
  }

  public async start(port = 0): Promise<number> {
    if (this.server) throw new Error('Conduit daemon is already running.');
    if (!isLoopbackAddress(this.bindAddress) && (!this.remoteEnabled || !this.tls)) {
      throw new Error('Non-loopback binding requires explicit remote mode and TLS configuration.');
    }
    const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
      void this.handleHttpRequest(req, res);
    };
    const server = this.tls
      ? https.createServer(this.tls, requestHandler)
      : http.createServer(requestHandler);
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
      server.listen(port, this.bindAddress);
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
    this.remoteSessions.clear();
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
    if (req.url === '/api/extension/pair' && req.method === 'OPTIONS') {
      const origin = extensionOrigin(req);
      if (!origin || !isLoopbackRemoteAddress(req.socket.remoteAddress)) {
        this.writeJson(
          res,
          403,
          createErrorResponse('PERMISSION_DENIED', 'Local extension pairing was denied.'),
        );
        return;
      }
      res.writeHead(204, extensionCorsHeaders(origin));
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/api/extension/pair') {
      await this.handleLocalExtensionPairing(req, res);
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      this.writeJson(res, 200, {
        status: 'ok',
        extensionConnected: this.isExtensionConnected(),
        instanceId: this.instanceId,
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/remote/pair') {
      if (!this.allowRemoteRequest(req, res)) return;
      await this.handleRemotePairing(req, res);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/remote/challenge') {
      if (!this.allowRemoteRequest(req, res)) return;
      await this.handleRemoteChallenge(req, res);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/remote/authenticate') {
      if (!this.allowRemoteRequest(req, res)) return;
      await this.handleRemoteAuthentication(req, res);
      return;
    }

    const isAction = req.method === 'POST' && req.url === '/api/action';
    const isConfirmationList = req.method === 'GET' && req.url === '/api/confirmations';
    const isConfirmationResponse =
      req.method === 'POST' && req.url === '/api/confirmations/respond';
    const isPairingStart = req.method === 'POST' && req.url === '/api/pairings/start';
    const isExtensionPairingStart =
      req.method === 'POST' && req.url === '/api/extension/pairings/start';
    const isPairingList = req.method === 'GET' && req.url === '/api/pairings';
    const isPairingDecision = req.method === 'POST' && req.url === '/api/pairings/respond';
    const isDeviceList = req.method === 'GET' && req.url === '/api/devices';
    const isDeviceRevoke = req.method === 'POST' && req.url === '/api/devices/revoke';
    const isShutdown = req.method === 'POST' && req.url === '/api/shutdown';
    if (
      !isAction &&
      !isConfirmationList &&
      !isConfirmationResponse &&
      !isPairingStart &&
      !isExtensionPairingStart &&
      !isPairingList &&
      !isPairingDecision &&
      !isDeviceList &&
      !isDeviceRevoke &&
      !isShutdown
    ) {
      this.writeJson(res, 404, createErrorResponse('INVALID_REQUEST', 'Unknown daemon endpoint.'));
      return;
    }

    const clientKey = `http:${req.socket.remoteAddress ?? 'unknown'}`;
    const authorization = this.authorizeHttpRequest(req);
    if (!authorization) {
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

    if (authorization.kind === 'remote' && !isAction) {
      this.writeJson(
        res,
        403,
        createErrorResponse('PERMISSION_DENIED', 'Remote sessions cannot manage Conduit.'),
      );
      return;
    }

    if (isShutdown) {
      if (!this.shutdownHandler) {
        this.writeJson(
          res,
          409,
          createErrorResponse('INVALID_REQUEST', 'Daemon shutdown is not externally managed.'),
        );
        return;
      }
      this.writeJson(res, 202, { stopping: true, instanceId: this.instanceId });
      setImmediate(this.shutdownHandler);
      return;
    }

    if (isPairingStart) {
      const pairingCode = this.pairing.createCode();
      this.audit.log({ type: 'device.pairing.started', outcome: 'success' });
      this.writeJson(res, 201, pairingCode);
      return;
    }

    if (isExtensionPairingStart) {
      const pairingCode = this.localPairing.create();
      this.audit.log({ type: 'extension.pairing.started', outcome: 'success' });
      this.writeJson(res, 201, pairingCode);
      return;
    }

    if (isPairingList) {
      this.writeJson(res, 200, { pairings: this.pairing.listPending() });
      return;
    }

    if (isPairingDecision) {
      await this.handlePairingDecision(req, res);
      return;
    }

    if (isDeviceList) {
      this.writeJson(res, 200, { devices: this.devices.list() });
      return;
    }

    if (isDeviceRevoke) {
      await this.handleDeviceRevocation(req, res);
      return;
    }

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
    if (
      authorization.kind === 'remote' &&
      !authorization.permissions.includes(requiredPermissionFor(browserRequest))
    ) {
      this.audit.log({
        type: 'permission.decision',
        outcome: 'denied',
        requestId: browserRequest.id,
        operation: browserRequest.type,
        details: { deviceId: authorization.deviceId, source: 'device-grant' },
      });
      this.writeJson(
        res,
        403,
        createErrorResponse(
          'PERMISSION_DENIED',
          'The trusted device is not granted permission for this operation.',
          browserRequest.id,
        ),
      );
      return;
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

    // Never inspect the host filesystem until both permission and any required
    // user confirmation have succeeded.
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
        this.audit.log({
          type: 'extension.response',
          outcome: 'failure',
          details: {
            reason: 'protocol-validation',
            issues: response.error.issues.map((issue) => issue.message),
          },
        });
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
      this.audit.log({
        type: 'extension.response',
        outcome: 'success',
        correlationId,
      });
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

  private async handleLocalExtensionPairing(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const origin = extensionOrigin(req);
    if (!origin || !isLoopbackRemoteAddress(req.socket.remoteAddress)) {
      this.audit.log({ type: 'extension.pairing', outcome: 'denied' });
      this.writeJson(
        res,
        403,
        createErrorResponse('PERMISSION_DENIED', 'Local extension pairing was denied.'),
      );
      return;
    }
    const clientKey = `extension-pair:${req.socket.remoteAddress ?? 'unknown'}`;
    const limit = this.localPairingAttempts.attempt(clientKey);
    if (!limit.allowed) {
      this.writeJson(
        res,
        429,
        createErrorResponse('RATE_LIMITED', 'Too many extension pairing attempts.', undefined, {
          retryAfterMs: limit.retryAfterMs,
        }),
        extensionCorsHeaders(origin),
      );
      return;
    }
    const body = await this.readBody(req);
    if (!body.ok) {
      this.writeJson(res, body.status, body.response, extensionCorsHeaders(origin));
      return;
    }
    const parsed = ExtensionPairingRequestSchema.safeParse(body.value);
    if (!parsed.success || !this.localPairing.consume(parsed.data.code)) {
      this.audit.log({ type: 'extension.pairing', outcome: 'denied' });
      this.writeJson(
        res,
        401,
        createErrorResponse(
          'AUTHENTICATION_FAILED',
          'Extension pairing code is invalid or expired.',
        ),
        extensionCorsHeaders(origin),
      );
      return;
    }
    this.localPairingAttempts.reset(clientKey);
    this.audit.log({ type: 'extension.pairing', outcome: 'success' });
    this.writeJson(res, 200, { token: this.auth.ensureToken() }, extensionCorsHeaders(origin));
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
        this.audit.log({
          type: 'browser.action.timeout',
          outcome: 'failure',
          requestId,
        });
        resolve(
          createErrorResponse(
            'ACTION_TIMEOUT',
            'Browser extension did not respond before timeout.',
            requestId,
          ),
        );
      }, this.requestTimeoutMs);

      this.pendingRequests.set(requestId, { resolve, timer });
      this.audit.log({
        type: 'browser.action.forwarded',
        outcome: 'pending',
        requestId,
      });
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
    for (const [tokenHash, session] of this.remoteSessions) {
      if (session.expiresAt <= now) this.remoteSessions.delete(tokenHash);
    }
  }

  private pruneRecentRequestIds(now = Date.now()): void {
    for (const [requestId, expiresAt] of this.recentRequestIds) {
      if (expiresAt <= now) this.recentRequestIds.delete(requestId);
    }
  }

  private authorizeHttpRequest(req: http.IncomingMessage): ClientAuthorization | null {
    const authorization = req.headers.authorization;
    const bearerToken =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : undefined;
    const headerToken = req.headers['x-conduit-token'];
    const token = bearerToken ?? (typeof headerToken === 'string' ? headerToken : undefined);

    if (typeof token !== 'string') return null;
    if (this.auth.verifyToken(token)) return { kind: 'local' };
    const tokenHash = hashRemoteSessionToken(token);
    const session = this.remoteSessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.remoteSessions.delete(tokenHash);
      return null;
    }
    const device = this.devices.get(session.deviceId);
    if (!device || device.revokedAt !== undefined) {
      this.remoteSessions.delete(tokenHash);
      return null;
    }
    return {
      kind: 'remote',
      deviceId: session.deviceId,
      permissions: [...session.permissions],
    };
  }

  private async handleRemotePairing(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!this.requireRemoteMode(res)) return;
    const body = await this.readBody(req);
    if (!body.ok) {
      this.writeJson(res, body.status, body.response);
      return;
    }
    const parsed = PairingRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      this.writeJson(res, 400, createErrorResponse('INVALID_REQUEST', 'Invalid pairing request.'));
      return;
    }
    try {
      const pairing = this.pairing.submit(parsed.data);
      this.audit.log({
        type: 'device.pairing.requested',
        outcome: 'pending',
        details: { pairingId: pairing.id, fingerprint: pairing.fingerprint },
      });
      this.writeJson(res, 202, {
        pairingId: pairing.id,
        fingerprint: pairing.fingerprint,
        expiresAt: pairing.expiresAt,
        status: 'pending',
      });
    } catch (error) {
      this.writePairingError(res, error);
    }
  }

  private async handleRemoteChallenge(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!this.requireRemoteMode(res)) return;
    const body = await this.readBody(req);
    if (!body.ok) {
      this.writeJson(res, body.status, body.response);
      return;
    }
    const parsed = RemoteChallengeRequestSchema.safeParse(body.value);
    if (
      !parsed.success ||
      parsed.data.requestDigest !== remoteSessionDigest(parsed.data.deviceId)
    ) {
      this.writeJson(
        res,
        400,
        createErrorResponse('INVALID_REQUEST', 'Invalid remote session challenge request.'),
      );
      return;
    }
    try {
      this.writeJson(
        res,
        201,
        this.remoteAuthenticator.createChallenge(parsed.data.deviceId, parsed.data.requestDigest),
      );
    } catch (error) {
      this.writePairingError(res, error);
    }
  }

  private async handleRemoteAuthentication(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!this.requireRemoteMode(res)) return;
    const body = await this.readBody(req);
    if (!body.ok) {
      this.writeJson(res, body.status, body.response);
      return;
    }
    const parsed = RemoteAuthenticationSchema.safeParse(body.value);
    if (
      !parsed.success ||
      parsed.data.requestDigest !== remoteSessionDigest(parsed.data.deviceId)
    ) {
      this.writeJson(
        res,
        400,
        createErrorResponse('INVALID_REQUEST', 'Invalid remote authentication request.'),
      );
      return;
    }
    try {
      const device = this.remoteAuthenticator.verify(
        parsed.data.deviceId,
        parsed.data.challengeId,
        parsed.data.requestDigest,
        parsed.data.signature,
      );
      const sessionToken = crypto.randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + this.remoteSessionTimeoutMs;
      this.remoteSessions.set(hashRemoteSessionToken(sessionToken), {
        deviceId: device.id,
        permissions: [...device.permissions],
        expiresAt,
      });
      this.audit.log({
        type: 'device.authentication',
        outcome: 'success',
        details: { deviceId: device.id },
      });
      this.writeJson(res, 200, {
        token: sessionToken,
        expiresAt,
        deviceId: device.id,
        permissions: device.permissions,
      });
    } catch (error) {
      this.audit.log({ type: 'device.authentication', outcome: 'denied' });
      this.writePairingError(res, error);
    }
  }

  private async handlePairingDecision(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    if (!body.ok) {
      this.writeJson(res, body.status, body.response);
      return;
    }
    const parsed = PairingDecisionSchema.safeParse(body.value);
    if (!parsed.success) {
      this.writeJson(res, 400, createErrorResponse('INVALID_REQUEST', 'Invalid pairing decision.'));
      return;
    }
    try {
      if (!parsed.data.approved) {
        const denied = this.pairing.deny(parsed.data.pairingId);
        this.audit.log({ type: 'device.pairing.denied', outcome: 'denied' });
        this.writeJson(res, denied ? 200 : 404, { denied });
        return;
      }
      const device = this.pairing.approve(parsed.data.pairingId, parsed.data.grantedPermissions);
      this.audit.log({
        type: 'device.pairing.approved',
        outcome: 'success',
        details: { deviceId: device.id, fingerprint: device.fingerprint },
      });
      this.writeJson(res, 201, { device });
    } catch (error) {
      this.writePairingError(res, error);
    }
  }

  private async handleDeviceRevocation(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    if (!body.ok) {
      this.writeJson(res, body.status, body.response);
      return;
    }
    const parsed = DeviceRevocationRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      this.writeJson(
        res,
        400,
        createErrorResponse('INVALID_REQUEST', 'Invalid device revocation request.'),
      );
      return;
    }
    const revoked = this.devices.revoke(parsed.data.deviceId);
    if (revoked) {
      for (const [tokenHash, session] of this.remoteSessions) {
        if (session.deviceId === parsed.data.deviceId) this.remoteSessions.delete(tokenHash);
      }
    }
    this.audit.log({
      type: 'device.revoked',
      outcome: revoked ? 'success' : 'failure',
      details: { deviceId: parsed.data.deviceId },
    });
    this.writeJson(res, revoked ? 200 : 404, { revoked });
  }

  private requireRemoteMode(res: http.ServerResponse): boolean {
    if (this.remoteEnabled) return true;
    this.writeJson(
      res,
      403,
      createErrorResponse('PERMISSION_DENIED', 'Remote-device access is disabled.'),
    );
    return false;
  }

  private allowRemoteRequest(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const limit = this.remoteRequestLimits.attempt(req.socket.remoteAddress ?? 'unknown');
    if (limit.allowed) return true;
    this.writeJson(
      res,
      429,
      createErrorResponse('RATE_LIMITED', 'Remote request rate limit exceeded.', undefined, {
        retryAfterMs: limit.retryAfterMs,
      }),
    );
    return false;
  }

  private writePairingError(res: http.ServerResponse, error: unknown): void {
    if (!(error instanceof PairingError)) {
      this.writeJson(res, 500, createErrorResponse('INTERNAL_ERROR', 'Remote operation failed.'));
      return;
    }
    const status =
      error.code === 'PAIRING_CODE_EXPIRED'
        ? 410
        : error.code === 'AUTHENTICATION_FAILED'
          ? 401
          : error.code === 'DEVICE_REVOKED'
            ? 403
            : 400;
    this.writeJson(res, status, createErrorResponse(error.code, error.message));
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
    if (
      request.type === 'browser.navigate' ||
      request.type === 'browser.open_tab' ||
      request.type === 'browser.list_tabs' ||
      request.type === 'browser.get_active_tab' ||
      request.type === 'browser.get_downloads'
    )
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

  private writeJson(
    res: http.ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): void {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }
}

function isLoopbackAddress(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === 'localhost';
}

function isLoopbackRemoteAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function extensionOrigin(req: http.IncomingMessage): string | undefined {
  const origin = req.headers.origin;
  return typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/u.test(origin)
    ? origin
    : undefined;
}

function extensionCorsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function hashRemoteSessionToken(token: string): string {
  return crypto.createHash('sha256').update(`conduit.remote.session:${token}`).digest('hex');
}

function remoteSessionDigest(deviceId: string): string {
  return digestRemoteRequest({ deviceId, purpose: 'conduit.remote.session.v1' });
}
