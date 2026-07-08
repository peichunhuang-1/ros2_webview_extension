import * as vscode from 'vscode';
import { getWebviewHtml, getWebviewErrorHtml } from './webviewHtml';
import { parseGraphDocumentText, type GraphDocument } from './graphTypes';
import { ros2Connection } from './ros2Connection';

export const GRAPH_EDITOR_VIEW_TYPE = 'ros2-webview-extension.graphEditor';

// Custom editor for `.ros2graph.json` node-graph files. Structurally the same
// as LayoutEditorProvider: push the parsed document into the webview on load
// and on external edits, and persist webview edits back as text-document edits.
// The node-graph has no reference images, so there's no upload path — just the
// interface/graph listing calls the channel type-picker reuses from the sidebar.
export default class GraphEditorProvider implements vscode.CustomTextEditorProvider {
  // Tracks the last text this provider itself wrote per document, so the
  // onDidChangeTextDocument listener below doesn't echo the webview's own
  // edits back to itself (it should only re-push on *external* changes/undo).
  private lastWrittenText = new Map<string, string>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri,
        vscode.Uri.joinPath(this.extensionUri, 'media', 'web-content', 'dist', 'assets'),
      ],
    };

    try {
      webviewPanel.webview.html = getWebviewHtml(webviewPanel.webview, this.extensionUri, 'graph-editor');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      webviewPanel.webview.html = getWebviewErrorHtml(msg);
      return;
    }

    const key = document.uri.toString();

    const pushInit = () => {
      const doc = parseGraphDocumentText(document.getText());
      void webviewPanel.webview.postMessage({ type: 'graph/init', payload: { doc } });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() !== key) { return; }
      if (e.document.getText() === this.lastWrittenText.get(key)) { return; }
      pushInit();
    });

    webviewPanel.webview.onDidReceiveMessage(async (e: { type: string; payload?: unknown; __id?: number }) => {
      if (e.type === 'graph/ready') {
        pushInit();
        return;
      }

      if (e.type === 'graph/update') {
        const doc = e.payload as GraphDocument;
        const text = JSON.stringify(doc, null, 2) + '\n';
        this.lastWrittenText.set(key, text);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
        await vscode.workspace.applyEdit(edit);
        return;
      }

      // The channel type-picker reuses the same interface/graph listing calls as
      // the sidebar's InterfaceBrowser/GraphBrowser (see respond() helper below).
      if (e.type === 'ros2/interfaces/list' && e.__id !== undefined) {
        await respond(webviewPanel.webview, e.__id, () => ros2Connection.listInterfaces());
        return;
      }

      if (e.type === 'ros2/graph/list' && e.__id !== undefined) {
        await respond(webviewPanel.webview, e.__id, () => ros2Connection.listGraph());
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      this.lastWrittenText.delete(key);
    });
  }
}

// Runs a request handler and posts its result (or error message) back to the
// webview under the request's __id — the response half of the promise bridge
// in media/web-content/src/ros2_apis/bridge.ts. (Same shape as the helper in
// layoutEditorProvider.ts; kept local to avoid a cross-provider import.)
async function respond(webview: vscode.Webview, id: number, handler: () => Promise<unknown> | unknown): Promise<void> {
  try {
    const result = await handler();
    void webview.postMessage({ __id: id, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void webview.postMessage({ __id: id, error: msg });
  }
}
