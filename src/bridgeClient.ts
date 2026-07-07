import { readBridgeRegistry } from './bridgeRegistry';

// HTTP client side of the loopback bridge (see localBridgeServer.ts): how the
// MCP server process reaches into the live extension host. Kept separate from
// mcpServer.ts so the tool definitions there stay free of transport plumbing.

// The workspace key must match what the extension host derives (workspace folder fsPath) so we
// read the registry file the currently-active VS Code window last wrote to (see bridgeRegistry.ts).
const WORKSPACE_KEY = process.env.ROS2_WEBVIEW_WORKSPACE || process.cwd();

export const NO_BRIDGE_ERROR =
  'No active ROS2 Webview window is registered for this workspace. Open the "ROS2 Webview" panel ' +
  '(the icon in the Activity Bar) in VS Code to activate the extension.';

function unreachableBridgeError(port: number, err: unknown): string {
  return (
    `Could not reach the ROS2 Webview extension on port ${port} (${err instanceof Error ? err.message : String(err)}). ` +
    'The registered VS Code window may have been closed or become unresponsive (e.g. a paused debug session) — ' +
    'try closing extra windows for this workspace and reloading the one you are using.'
  );
}

export type BridgeCallResult<T> = { ok: true; data: T } | { ok: false; error: string };

interface BridgeCallOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
}

// One bridge round-trip. The port is re-read from the registry on every call rather
// than cached: the registered window (and its port) can change any time a window
// reloads or a new one activates.
export async function callBridge<T>(route: string, opts: BridgeCallOptions = {}): Promise<BridgeCallResult<T>> {
  const port = readBridgeRegistry(WORKSPACE_KEY)?.port ?? null;
  if (port === null) { return { ok: false, error: NO_BRIDGE_ERROR }; }

  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: opts.method ?? 'GET',
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 2000),
    });
  } catch (err) {
    return { ok: false, error: unreachableBridgeError(port, err) };
  }

  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    return { ok: false, error: data.error ?? `HTTP ${response.status}` };
  }
  return { ok: true, data };
}
