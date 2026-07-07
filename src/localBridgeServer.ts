import * as http from 'http';
import { focusStore } from './focusStore';
import { writeBridgeRegistry, clearBridgeRegistry } from './bridgeRegistry';

export interface LocalBridgeDeps {
  openPreview(filePath: string): Promise<void>;
  generateGuiScaffold(filePath: string): Promise<{ htmlPath: string; message: string }>;
}

export interface LocalBridgeHandle {
  server: http.Server;
  port: number;
  dispose(): void;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Collects the request body, runs the handler on the parsed JSON, and replies with the
// handler's result — or a 400 + { error } if the handler (or JSON parsing) throws.
function handleJsonPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handler: (body: Record<string, unknown>) => Promise<unknown>,
): void {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    (async () => handler(JSON.parse(body || '{}') as Record<string, unknown>))()
      .then(result => sendJson(res, 200, result ?? { ok: true }))
      .catch((err: unknown) => sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) }));
  });
}

function requirePath(body: Record<string, unknown>): string {
  const filePath = body.path;
  if (typeof filePath !== 'string' || !filePath) { throw new Error('Missing "path" in request body.'); }
  return filePath;
}

// A tiny loopback-only HTTP server so the MCP server (a separate OS process,
// spawned per-session by Claude Code / VS Code) can reach into the live
// extension host: read the focus selection, and ask it to open/refresh a
// generated-GUI preview panel.
//
// Binds to an OS-assigned port (0) rather than a fixed one: with a fixed
// port, multiple open windows (or a leftover Extension Development Host)
// race to bind it, and whichever wins can be a stale/paused process holding
// the port hostage while the window the user is actually using gets no
// server of its own. Instead, each window registers its own port in
// `workspacePath`'s registry file; the MCP server re-reads that file on
// every request to always find whichever window activated most recently.
export function startLocalBridgeServer(deps: LocalBridgeDeps, workspacePath: string): LocalBridgeHandle {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/focus') {
      sendJson(res, 200, focusStore.getState());
      return;
    }

    if (req.method === 'POST' && req.url === '/preview') {
      handleJsonPost(req, res, async body => { await deps.openPreview(requirePath(body)); });
      return;
    }

    if (req.method === 'POST' && req.url === '/scaffold') {
      handleJsonPost(req, res, body => deps.generateGuiScaffold(requirePath(body)));
      return;
    }

    res.writeHead(404).end();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error('ROS2 webview: local bridge server error:', err);
  });

  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as import('net').AddressInfo).port;
    writeBridgeRegistry(workspacePath, { port, pid: process.pid, updatedAt: Date.now() });
  });

  return {
    server,
    get port() { return (server.address() as import('net').AddressInfo | null)?.port ?? 0; },
    dispose() {
      clearBridgeRegistry(workspacePath, process.pid);
      server.close();
    },
  };
}
