import * as vscode from 'vscode';
import * as path from 'path';

// Name the MCP server is registered under, both in .mcp.json (Claude Code) and
// in the permission rules written by claudeCodeSetup.ts.
export const MCP_SERVER_NAME = 'ros2-interfaces';

// Environment variables the extension host passes to the spawned MCP server
// process (see mcpServer.ts, which reads them back).
export const WORKSPACE_ENV_VAR = 'ROS2_WEBVIEW_WORKSPACE';
export const ROSBRIDGE_URL_ENV_VAR = 'ROS2_WEBVIEW_ROSBRIDGE_URL';

export function getRosbridgeUrl(): string {
  return vscode.workspace.getConfiguration('ros2Webview').get<string>('rosbridgeUrl', 'ws://localhost:9090');
}

// Key for the bridge port registry file (see bridgeRegistry.ts) — must match
// between the extension host (writer) and the MCP server process (reader).
export function getWorkspaceKey(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'no-workspace';
}

export function resolveWorkspacePath(filePath: string): vscode.Uri {
  if (path.isAbsolute(filePath)) { return vscode.Uri.file(filePath); }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { throw new Error('No workspace folder open to resolve a relative path against.'); }
  return vscode.Uri.joinPath(folder.uri, filePath);
}

export async function readExtensionFile(context: vscode.ExtensionContext, ...segments: string[]): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, ...segments));
  return Buffer.from(bytes).toString('utf8');
}

export interface McpServerLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

// How to spawn the bundled MCP server — shared by the .mcp.json entry written
// for Claude Code and the vscode.lm MCP server definition provider, so the two
// can never drift apart on the command/env they use.
export function mcpServerLaunch(context: vscode.ExtensionContext): McpServerLaunch {
  return {
    command: process.execPath,
    args: [path.join(context.extensionUri.fsPath, 'dist', 'mcpServer.js')],
    env: {
      [WORKSPACE_ENV_VAR]: getWorkspaceKey(),
      [ROSBRIDGE_URL_ENV_VAR]: getRosbridgeUrl(),
    },
  };
}
