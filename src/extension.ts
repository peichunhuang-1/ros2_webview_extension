import * as vscode from 'vscode';
import WebviewPanelProvider from './WebviewPanelProvider';
import { startLocalBridgeServer } from './localBridgeServer';
import { PreviewPanelManager } from './previewPanel';
import LayoutEditorProvider, { LAYOUT_EDITOR_VIEW_TYPE } from './layoutEditorProvider';
import { emptyLayoutDocument } from './layoutTypes';
import type { VendorAssets } from './scaffoldGen';
import { loadVendorAssets, runGenerateScaffold } from './scaffoldRunner';
import { maybeOfferMcpSetup, setupClaudeCodeMcp } from './claudeCodeSetup';
import { getRosbridgeUrl, getWorkspaceKey, mcpServerLaunch, resolveWorkspacePath } from './workspaceConfig';

// A focused .ros2ui.json tab is a custom-editor webview (LayoutEditorProvider), not a
// TextEditor, so `vscode.window.activeTextEditor` (used by previewGeneratedUi below) can't
// find it — the active tab's input has to be read from the tab groups API instead.
function activeRos2uiJsonUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const uri = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? input.uri : undefined;
  return uri && /\.ros2ui\.json$/i.test(uri.fsPath) ? uri : undefined;
}

function registerWebviewProviders(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WebviewPanelProvider.viewType,
      new WebviewPanelProvider(context.extensionUri),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerCustomEditorProvider(
      LAYOUT_EDITOR_VIEW_TYPE,
      new LayoutEditorProvider(context.extensionUri),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
}

// The loopback HTTP server the MCP server process (a separate OS process) uses to reach
// into this extension host — see localBridgeServer.ts / bridgeRegistry.ts for the handshake.
function registerBridgeServer(
  context: vscode.ExtensionContext, previewManager: PreviewPanelManager, vendorAssets: VendorAssets,
): void {
  const bridgeServer = startLocalBridgeServer(
    {
      openPreview: async (filePath) => previewManager.open(resolveWorkspacePath(filePath)),
      generateGuiScaffold: async (filePath) => {
        const result = await runGenerateScaffold(resolveWorkspacePath(filePath), { allowPrompt: false }, vendorAssets);
        // allowPrompt: false never returns 'cancelled' (it throws instead) — this satisfies the type.
        if (result.status === 'cancelled') { throw new Error('Cancelled.'); }
        await previewManager.open(result.htmlUri);
        return { htmlPath: result.htmlUri.fsPath, message: result.message };
      },
    },
    getWorkspaceKey(),
  );
  context.subscriptions.push({ dispose: () => bridgeServer.dispose() });
}

function registerMcpServerDefinition(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('ros2-webview-extension.mcpServers', {
      provideMcpServerDefinitions: () => {
        const launch = mcpServerLaunch(context);
        const definition = new vscode.McpStdioServerDefinition('ROS2 Interfaces', launch.command, launch.args);
        definition.env = launch.env;
        return [definition];
      },
    })
  );
}

function registerCommands(
  context: vscode.ExtensionContext, previewManager: PreviewPanelManager, vendorAssets: VendorAssets,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ros2-webview-extension.setupClaudeCodeMcp', () => setupClaudeCodeMcp(context)),

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
    }),

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
    }),

    vscode.commands.registerCommand('ros2-webview-extension.generateGuiScaffold', async (uri?: vscode.Uri) => {
      const target = uri ?? activeRos2uiJsonUri();
      const layoutUri = target ?? (await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'ROS2 Layout': ['json'] },
        title: 'Select the .ros2ui.json layout file to generate a GUI scaffold from',
      }))?.[0];
      if (!layoutUri) { return; }

      try {
        const result = await runGenerateScaffold(layoutUri, { allowPrompt: true }, vendorAssets);
        if (result.status === 'cancelled') { return; }
        vscode.window.showInformationMessage(result.message);
        await previewManager.open(result.htmlUri);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to generate GUI scaffold: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
}

export async function activate(context: vscode.ExtensionContext) {
  const vendorAssets = await loadVendorAssets(context);
  const previewManager = new PreviewPanelManager(getRosbridgeUrl, vendorAssets);

  registerWebviewProviders(context);
  registerBridgeServer(context, previewManager, vendorAssets);
  registerMcpServerDefinition(context);
  registerCommands(context, previewManager, vendorAssets);

  void maybeOfferMcpSetup(context);
}

export function deactivate() {}
