// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import WebviewPanelProvider from './WebviewPanelProvider'
import { startLocalBridgeServer } from './localBridgeServer';
import { PreviewPanelManager } from './previewPanel';
import LayoutEditorProvider, { LAYOUT_EDITOR_VIEW_TYPE } from './layoutEditorProvider';
import { emptyLayoutDocument } from './layoutTypes';

const MCP_SERVER_NAME = 'ros2-interfaces';
const DISMISSED_KEY = 'ros2Mcp.setupDismissed';
const WORKSPACE_ENV_VAR = 'ROS2_WEBVIEW_WORKSPACE';
const ROSBRIDGE_URL_ENV_VAR = 'ROS2_WEBVIEW_ROSBRIDGE_URL';

type McpJson = { mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }> };

function getRosbridgeUrl(): string {
  return vscode.workspace.getConfiguration('ros2Webview').get<string>('rosbridgeUrl', 'ws://localhost:9090');
}

// Key for the bridge port registry file (see bridgeRegistry.ts) — must match
// between the extension host (writer) and the MCP server process (reader).
function getWorkspaceKey(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'no-workspace';
}

function resolvePreviewPath(filePath: string): vscode.Uri {
  if (path.isAbsolute(filePath)) { return vscode.Uri.file(filePath); }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { throw new Error('No workspace folder open to resolve a relative path against.'); }
  return vscode.Uri.joinPath(folder.uri, filePath);
}

async function readMcpJson(uri: vscode.Uri): Promise<McpJson> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as McpJson;
  } catch {
    return {};
  }
}

function serverEntry(context: vscode.ExtensionContext) {
  return {
    command: process.execPath,
    args: [path.join(context.extensionUri.fsPath, 'dist', 'mcpServer.js')],
    env: {
      [WORKSPACE_ENV_VAR]: getWorkspaceKey(),
      [ROSBRIDGE_URL_ENV_VAR]: getRosbridgeUrl(),
    },
  };
}

type ClaudeSettingsJson = {
  enabledMcpjsonServers?: string[];
  permissions?: { allow?: string[] } & Record<string, unknown>;
} & Record<string, unknown>;

// Claude Code gates a project MCP server behind two separate approvals: first
// whether to trust the server declared in .mcp.json at all (enabledMcpjsonServers),
// then — once trusted — whether to approve each individual tool call
// (permissions.allow). Both have to be granted, or the user still gets
// prompted at the first gate even though the second is wide open. "Set Up"
// grants both up front rather than leaving the user to discover either by hand.
//
// Written to settings.local.json rather than settings.json: Claude Code
// requires the user to click through a one-time "trust this folder" prompt
// before it honors *project*-tier settings (committed, potentially authored
// by someone else) — but settings.local.json is a different tier, always
// treated as the user's own, so these grants take effect immediately with
// no extra prompt.
async function grantClaudeCodeMcpPermission(folder: vscode.WorkspaceFolder): Promise<void> {
  const settingsUri = vscode.Uri.joinPath(folder.uri, '.claude', 'settings.local.json');
  const permissionRule = `mcp__${MCP_SERVER_NAME}__*`;

  let settings: ClaudeSettingsJson = {};
  try {
    const bytes = await vscode.workspace.fs.readFile(settingsUri);
    settings = JSON.parse(Buffer.from(bytes).toString('utf8')) as ClaudeSettingsJson;
  } catch {
    // No existing file (or unreadable) — start fresh rather than fail setup.
  }

  const enabledServers = (settings.enabledMcpjsonServers ??= []);
  if (!enabledServers.includes(MCP_SERVER_NAME)) {
    enabledServers.push(MCP_SERVER_NAME);
  }

  settings.permissions ??= {};
  const allow = (settings.permissions.allow ??= []);
  if (!allow.includes(permissionRule)) {
    allow.push(permissionRule);
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.claude'));
  await vscode.workspace.fs.writeFile(settingsUri, Buffer.from(JSON.stringify(settings, null, 2) + '\n', 'utf8'));
}

async function readExtensionFile(context: vscode.ExtensionContext, ...segments: string[]): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, ...segments));
  return Buffer.from(bytes).toString('utf8');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CLAUDE_MD_BLOCK_START = '<!-- ros2-webview-extension: managed block, edits here are overwritten by "Set Up" -->';
const CLAUDE_MD_BLOCK_END = '<!-- /ros2-webview-extension -->';

// CLAUDE.md is project-scoped — Claude Code only reads it from whatever workspace it's
// pointed at, so bundling it with the extension does nothing for a user's own ROS2 project
// until it's copied there. "Set Up" does that, the same way it already does for .mcp.json
// and settings.local.json above.
//
// The MCP server's own `instructions` field (see mcpServer.ts) carries a condensed version
// of this same guidance unconditionally, over the protocol itself, regardless of whether the
// user ever runs "Set Up" — this file-based copy is the fuller version for those who do.
async function installClaudeMdSection(folder: vscode.WorkspaceFolder, context: vscode.ExtensionContext): Promise<void> {
  const claudeMdUri = vscode.Uri.joinPath(folder.uri, 'CLAUDE.md');
  const sectionBody = (await readExtensionFile(context, 'CLAUDE.md')).trim();
  const block = `${CLAUDE_MD_BLOCK_START}\n${sectionBody}\n${CLAUDE_MD_BLOCK_END}`;

  let existing = '';
  try {
    const bytes = await vscode.workspace.fs.readFile(claudeMdUri);
    existing = Buffer.from(bytes).toString('utf8');
  } catch {
    // No existing file — the block becomes the entire content.
  }

  const blockRe = new RegExp(`${escapeRegExp(CLAUDE_MD_BLOCK_START)}[\\s\\S]*?${escapeRegExp(CLAUDE_MD_BLOCK_END)}`);
  const next = blockRe.test(existing)
    ? existing.replace(blockRe, block)
    : existing
      ? `${existing.trimEnd()}\n\n${block}\n`
      : `${block}\n`;

  await vscode.workspace.fs.writeFile(claudeMdUri, Buffer.from(next, 'utf8'));
}

async function setupClaudeCodeMcp(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('Open a folder/workspace first to set up the ROS2 MCP server.');
    return;
  }

  const mcpJsonUri = vscode.Uri.joinPath(folder.uri, '.mcp.json');
  const config = await readMcpJson(mcpJsonUri);
  config.mcpServers ??= {};
  config.mcpServers[MCP_SERVER_NAME] = serverEntry(context);

  await vscode.workspace.fs.writeFile(mcpJsonUri, Buffer.from(JSON.stringify(config, null, 2) + '\n', 'utf8'));
  await grantClaudeCodeMcpPermission(folder);
  await installClaudeMdSection(folder, context);
  vscode.window.showInformationMessage(
    'ROS2 MCP server registered in .mcp.json (tool calls pre-approved) with CLAUDE.md guidance installed. ' +
    'Restart Claude Code (or run /mcp) to pick it up.',
  );
}

async function maybeOfferMcpSetup(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || context.globalState.get<boolean>(DISMISSED_KEY)) { return; }

  const config = await readMcpJson(vscode.Uri.joinPath(folder.uri, '.mcp.json'));
  if (config.mcpServers?.[MCP_SERVER_NAME]) { return; }

  const choice = await vscode.window.showInformationMessage(
    'Let Claude Code read ROS2 msg/srv/action schemas in this workspace via MCP?',
    'Set Up', "Don't Ask Again",
  );
  if (choice === 'Set Up') {
    await setupClaudeCodeMcp(context);
  } else if (choice === "Don't Ask Again") {
    await context.globalState.update(DISMISSED_KEY, true);
  }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

  const provider = new WebviewPanelProvider(context.extensionUri);
  provider.registEvent(provider.createOperationEventCallback());

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WebviewPanelProvider.viewType, provider,
      {webviewOptions: {
        retainContextWhenHidden: true
      }})
  );

  const previewManager = new PreviewPanelManager();

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      LAYOUT_EDITOR_VIEW_TYPE,
      new LayoutEditorProvider(context.extensionUri),
      { webviewOptions: { retainContextWhenHidden: true } },
    )
  );

  const bridgeServer = startLocalBridgeServer(
    { openPreview: async (filePath) => previewManager.open(resolvePreviewPath(filePath)) },
    getWorkspaceKey(),
  );
  context.subscriptions.push({ dispose: () => bridgeServer.dispose() });

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('ros2-webview-extension.mcpServers', {
      provideMcpServerDefinitions: () => {
        const serverPath = path.join(context.extensionUri.fsPath, 'dist', 'mcpServer.js');
        const definition = new vscode.McpStdioServerDefinition('ROS2 Interfaces', process.execPath, [serverPath]);
        definition.env = {
          [WORKSPACE_ENV_VAR]: getWorkspaceKey(),
          [ROSBRIDGE_URL_ENV_VAR]: getRosbridgeUrl(),
        };
        return [definition];
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ros2-webview-extension.setupClaudeCodeMcp', () => setupClaudeCodeMcp(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ros2-webview-extension.previewGeneratedUi', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target && /\.html?$/i.test(target.fsPath)) {
        await previewManager.open(target);
        return;
      }
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'HTML': ['html', 'htm'] },
        title: 'Select the generated UI to preview',
      });
      if (picked?.[0]) {
        await previewManager.open(picked[0]);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ros2-webview-extension.newLayoutFile', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showErrorMessage('Open a folder/workspace first to create a layout file.');
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Name for the new layout file',
        value: 'ui-layout',
        validateInput: v => v.trim() ? null : 'Enter a name.',
      });
      if (!name) { return; }

      const fileName = name.endsWith('.ros2ui.json') ? name : `${name}.ros2ui.json`;
      const uri = vscode.Uri.joinPath(folder.uri, fileName);

      try {
        await vscode.workspace.fs.stat(uri);
        vscode.window.showErrorMessage(`${fileName} already exists.`);
        return;
      } catch {
        // Doesn't exist yet — good, create it.
      }

      const content = JSON.stringify(emptyLayoutDocument(), null, 2) + '\n';
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      await vscode.commands.executeCommand('vscode.openWith', uri, LAYOUT_EDITOR_VIEW_TYPE);
    })
  );

  void maybeOfferMcpSetup(context);

}

// This method is called when your extension is deactivated
export function deactivate() {}
