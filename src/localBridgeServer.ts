import * as http from 'http';
import { focusStore } from './focusStore';

export const DEFAULT_BRIDGE_PORT = 47823;

export interface LocalBridgeDeps {
  openPreview(filePath: string): Promise<void>;
}

// A tiny loopback-only HTTP server so the MCP server (a separate OS process,
// spawned per-session by Claude Code / VS Code) can reach into the live
// extension host: read the focus selection, and ask it to open/refresh a
// generated-GUI preview panel.
export function startLocalBridgeServer(deps: LocalBridgeDeps, port: number = DEFAULT_BRIDGE_PORT): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/focus') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(focusStore.getState()));
      return;
    }

    if (req.method === 'POST' && req.url === '/preview') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        (async () => {
          const { path: filePath } = JSON.parse(body || '{}') as { path?: string };
          if (!filePath) { throw new Error('Missing "path" in request body.'); }
          await deps.openPreview(filePath);
        })()
          .then(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          })
          .catch((err: unknown) => {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
          });
      });
      return;
    }

    res.writeHead(404).end();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`ROS2 webview: local bridge server port ${port} already in use (another window is likely serving it).`);
    } else {
      console.error('ROS2 webview: local bridge server error:', err);
    }
  });

  server.listen(port, '127.0.0.1');
  return server;
}
