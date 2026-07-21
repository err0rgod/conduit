import { WebSocketServer, WebSocket } from 'ws';
import { LocalAuth } from '@conduit/security';
import * as http from 'http';

export class Daemon {
  private wss: WebSocketServer | null = null;
  private server: http.Server | null = null;
  private auth: LocalAuth;

  constructor() {
    this.auth = new LocalAuth();
  }

  private activeExtension: WebSocket | null = null;
  private pendingRequests: Map<string, (res: any) => void> = new Map();

  public async start(port: number = 0): Promise<number> {
    this.server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/action') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          if (!this.activeExtension) {
            res.writeHead(503);
            res.end(JSON.stringify({ error: 'No extension connected' }));
            return;
          }
          const id = crypto.randomUUID();
          this.pendingRequests.set(id, (response) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
          });
          try {
            const parsed = JSON.parse(body);
            parsed.correlationId = id;
            this.activeExtension.send(JSON.stringify(parsed));
          } catch (e) {
            this.pendingRequests.delete(id);
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: WebSocket) => {
      let authenticated = false;

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          if (!authenticated) {
            if (message.type === 'auth' && this.auth.verifyToken(message.payload?.token)) {
              authenticated = true;
              this.activeExtension = ws;
              ws.send(JSON.stringify({ type: 'auth_success' }));
            } else {
              ws.send(JSON.stringify({ type: 'error', error: { code: 'AUTHENTICATION_FAILED' } }));
              ws.close();
            }
            return;
          }

          if (message.correlationId && this.pendingRequests.has(message.correlationId)) {
            const resolver = this.pendingRequests.get(message.correlationId)!;
            this.pendingRequests.delete(message.correlationId);
            resolver(message);
          }
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', error: { code: 'INVALID_REQUEST' } }));
        }
      });

      ws.on('close', () => {
        if (this.activeExtension === ws) {
          this.activeExtension = null;
        }
      });
    });

    return new Promise((resolve) => {
      this.server!.listen(port, '127.0.0.1', () => {
        const address = this.server!.address();
        resolve(typeof address === 'string' ? 0 : address!.port);
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.wss) {
      this.wss.clients.forEach((client) => client.close());
      this.wss.close();
    }
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => resolve());
      });
    }
  }

  public getToken(): string {
    return this.auth.ensureToken();
  }
}

// If run directly
if (require.main === module) {
  const daemon = new Daemon();
  daemon.start(9222).then((port) => {
    console.log(`Conduit daemon started on 127.0.0.1:${port}`);
    console.log(`Local Token: ${daemon.getToken()}`);
  });

  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await daemon.stop();
    process.exit(0);
  });
}
