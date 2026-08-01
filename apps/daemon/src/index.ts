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

export class Daemon {
  private readonly auth: Authenticator;
  private readonly requestTimeoutMs: number;
  private readonly maxBodyBytes: number;
  private readonly policy: SecurityPolicy;
  private readonly confirmations: ConfirmationManager;
  private readonly audit: AuditLogger;
  private readonly uploadAllowlist: string[];
  private readonly maxUploadFileBytes: number;
  private readonly tabUrls = new Map<number, string>();
  private activeTabId: number | null = null;
  private activeExtension: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;

  public constructor(options: DaemonOptions = {}) {
    this.auth = options.auth ?? new LocalAuth();
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.policy = options.policy ?? new SecurityPolicy();
    this.confirmations = options.confirmations ?? new ConfirmationManager();
    this.audit = options.audit ?? new AuditLogger();
    this.uploadAllowlist = options.uploadAllowlist ?? [];
    this.maxUploadFileBytes = options.maxUploadFileBytes ?? 10 * 1024 * 1024;
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
        this.audit.log({ type: 'daemon.start', outcome: 'success' });
        resolve(typeof address === 'string' || !address ? 0 : address.port);
      });
    });
  }

  public async stop(): Promise<void> {
    this.audit.log({ type: 'daemon.stop', outcome: 'success' });
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

    const isAction = req.method === 'POST' && req.url === '/api/action';
    const isConfirmationList = req.method === 'GET' && req.url === '/api/confirmations';
    const isConfirmationResponse =
      req.method === 'POST' && req.url === '/api/confirmations/respond';
    if (!isAction && !isConfirmationList && !isConfirmationResponse) {
      this.writeJson(res, 404, createErrorResponse('INVALID_REQUEST', 'Unknown daemon endpoint.'));
      return;
    }

    if (!this.isAuthorizedHttpRequest(req)) {
      this.audit.log({ type: 'client.authentication', outcome: 'denied' });
      this.writeJson(
        res,
        401,
        createErrorResponse('AUTHENTICATION_REQUIRED', 'A valid Conduit local token is required.'),
      );
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
          this.audit.log({ type: 'extension.authentication', outcome: 'success' });
          return;
        }

        ws.send(
          JSON.stringify({
            type: 'error',
            error: { code: 'AUTHENTICATION_FAILED', message: 'Extension authentication failed.' },
          }),
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
    console.log(`Local token: ${daemon.getToken()}`);
  });

  process.on('SIGINT', () => {
    void daemon.stop().then(() => process.exit(0));
  });
}
