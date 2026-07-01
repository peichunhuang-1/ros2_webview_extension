import * as http from 'http';
import { focusStore } from './focusStore';

export const DEFAULT_FOCUS_PORT = 47823;

// A tiny loopback-only HTTP server so the MCP server (a separate OS process,
// spawned per-session by Claude Code / VS Code) can ask for the live focus
// selection instead of us persisting it to disk.
export function startFocusServer(port: number = DEFAULT_FOCUS_PORT): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/focus') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(focusStore.getState()));
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`ROS2 webview: focus server port ${port} already in use (another window is likely serving it).`);
    } else {
      console.error('ROS2 webview: focus server error:', err);
    }
  });

  server.listen(port, '127.0.0.1');
  return server;
}
