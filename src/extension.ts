// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import WebviewPanelProvider from './WebviewPanelProvider'
import { startFocusServer, DEFAULT_FOCUS_PORT } from './focusServer';

const MCP_SERVER_NAME = 'ros2-interfaces';
const DISMISSED_KEY = 'ros2Mcp.setupDismissed';
const FOCUS_PORT_ENV_VAR = 'ROS2_WEBVIEW_FOCUS_PORT';

type McpJson = { mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }> };

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
    env: { [FOCUS_PORT_ENV_VAR]: String(DEFAULT_FOCUS_PORT) },
  };
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
  vscode.window.showInformationMessage('ROS2 MCP server registered in .mcp.json. Restart Claude Code (or run /mcp) to pick it up.');
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

  const focusServer = startFocusServer();
  context.subscriptions.push({ dispose: () => focusServer.close() });

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('ros2-webview-extension.mcpServers', {
      provideMcpServerDefinitions: () => {
        const serverPath = path.join(context.extensionUri.fsPath, 'dist', 'mcpServer.js');
        const definition = new vscode.McpStdioServerDefinition('ROS2 Interfaces', process.execPath, [serverPath]);
        definition.env = { [FOCUS_PORT_ENV_VAR]: String(DEFAULT_FOCUS_PORT) };
        return [definition];
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ros2-webview-extension.setupClaudeCodeMcp', () => setupClaudeCodeMcp(context))
  );

  void maybeOfferMcpSetup(context);

}

// This method is called when your extension is deactivated
export function deactivate() {}
