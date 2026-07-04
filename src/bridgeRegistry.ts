import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Each VS Code window binds the local bridge server to its own OS-assigned
// port (never a fixed one, so multiple windows/Extension Development Hosts
// never fight over a single port). The most recently activated window for a
// given workspace writes its port here; the MCP server (a separate, longer-
// lived process) re-reads this file on every request instead of caching a
// port at startup, so it always finds whichever window is actually live.

export interface BridgeRegistryEntry {
  port: number;
  pid: number;
  updatedAt: number;
}

function registryPath(workspacePath: string): string {
  const hash = crypto.createHash('md5').update(workspacePath).digest('hex');
  return path.join(os.tmpdir(), `ros2-webview-bridge-${hash}.json`);
}

export function writeBridgeRegistry(workspacePath: string, entry: BridgeRegistryEntry): void {
  fs.writeFileSync(registryPath(workspacePath), JSON.stringify(entry), 'utf8');
}

export function readBridgeRegistry(workspacePath: string): BridgeRegistryEntry | null {
  try {
    return JSON.parse(fs.readFileSync(registryPath(workspacePath), 'utf8')) as BridgeRegistryEntry;
  } catch {
    return null;
  }
}

// Best-effort: only clears the file if it still points at this process, so a
// window shutting down never clobbers a newer window's registration.
export function clearBridgeRegistry(workspacePath: string, pid: number): void {
  const current = readBridgeRegistry(workspacePath);
  if (current && current.pid === pid) {
    try { fs.unlinkSync(registryPath(workspacePath)); } catch { /* already gone */ }
  }
}
