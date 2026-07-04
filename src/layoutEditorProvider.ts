import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import { getWebviewHtml, getWebviewErrorHtml } from './webviewHtml';
import { emptyLayoutDocument, type LayoutDocument, type LayoutPanel } from './layoutTypes';
import type { FocusEntry } from './focusStore';
import { ros2Connection } from './ros2Connection';

export const LAYOUT_EDITOR_VIEW_TYPE = 'ros2-webview-extension.layoutEditor';

// Layout files written before `canvas.gridSize` was introduced won't have it;
// backfill so downstream code can always rely on the field being present.
// Similarly, panels used to carry a single `binding` field before a panel
// could bind to multiple interfaces — migrate it into `bindings` on load.
function parseDocument(document: vscode.TextDocument): LayoutDocument {
  const text = document.getText().trim();
  if (!text) { return emptyLayoutDocument(); }
  try {
    const doc = JSON.parse(text) as LayoutDocument;
    if (!doc.canvas.gridSize) { doc.canvas.gridSize = emptyLayoutDocument().canvas.gridSize; }
    doc.panels = doc.panels.map(normalizePanelBindings);
    return doc;
  } catch {
    return emptyLayoutDocument();
  }
}

function normalizePanelBindings(panel: LayoutPanel): LayoutPanel {
  if (Array.isArray(panel.bindings)) { return panel; }
  const { binding, ...rest } = panel as LayoutPanel & { binding?: FocusEntry | null };
  return { ...rest, bindings: binding ? [binding] : [] };
}

// Uploaded reference images live next to the layout file, e.g.
// "dashboard.ros2ui.json" -> "dashboard.assets/<slug>-<id>.<ext>", so they're
// colocated and discoverable in the file tree rather than base64-bloating the JSON.
function assetsDirFor(documentUri: vscode.Uri): vscode.Uri {
  const dir = path.dirname(documentUri.fsPath);
  const base = path.basename(documentUri.fsPath).replace(/\.ros2ui\.json$/, '');
  return vscode.Uri.file(path.join(dir, `${base}.assets`));
}

export default class LayoutEditorProvider implements vscode.CustomTextEditorProvider {
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
    const dir = vscode.Uri.file(path.dirname(document.uri.fsPath));
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri,
        vscode.Uri.joinPath(this.extensionUri, 'media', 'web-content', 'dist', 'assets'),
        dir,
      ],
    };

    try {
      webviewPanel.webview.html = getWebviewHtml(webviewPanel.webview, this.extensionUri, 'layout-editor');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      webviewPanel.webview.html = getWebviewErrorHtml(msg);
      return;
    }

    const key = document.uri.toString();

    const pushInit = () => {
      const doc = parseDocument(document);
      const imageUris: Record<string, string> = {};
      for (const panel of doc.panels) {
        if (panel.image) {
          imageUris[panel.image] = webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(dir, panel.image)).toString();
        }
      }
      void webviewPanel.webview.postMessage({ type: 'layout/init', payload: { doc, imageUris } });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() !== key) { return; }
      if (e.document.getText() === this.lastWrittenText.get(key)) { return; }
      pushInit();
    });

    webviewPanel.webview.onDidReceiveMessage(async (e: { type: string; payload?: unknown; __id?: number }) => {
      if (e.type === 'layout/ready') {
        pushInit();
        return;
      }

      if (e.type === 'layout/update') {
        const doc = e.payload as LayoutDocument;
        const text = JSON.stringify(doc, null, 2) + '\n';
        this.lastWrittenText.set(key, text);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
        await vscode.workspace.applyEdit(edit);
        return;
      }

      if (e.type === 'layout/uploadImage' && e.__id !== undefined) {
        try {
          const { dataUri, suggestedName } = e.payload as { dataUri: string; suggestedName: string };
          const result = await this.saveImage(document.uri, webviewPanel.webview, dataUri, suggestedName);
          void webviewPanel.webview.postMessage({ __id: e.__id, result });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          void webviewPanel.webview.postMessage({ __id: e.__id, error: msg });
        }
        return;
      }

      // The binding picker in the panel-edit modal reuses the same interface/graph
      // listing calls as the sidebar's InterfaceBrowser/GraphBrowser.
      if (e.type === 'ros2/interfaces/list' && e.__id !== undefined) {
        try {
          const result = ros2Connection.listInterfaces();
          void webviewPanel.webview.postMessage({ __id: e.__id, result });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          void webviewPanel.webview.postMessage({ __id: e.__id, error: msg });
        }
        return;
      }

      if (e.type === 'ros2/graph/list' && e.__id !== undefined) {
        try {
          const result = await ros2Connection.listGraph();
          void webviewPanel.webview.postMessage({ __id: e.__id, result });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          void webviewPanel.webview.postMessage({ __id: e.__id, error: msg });
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      this.lastWrittenText.delete(key);
    });
  }

  private async saveImage(
    documentUri: vscode.Uri,
    webview: vscode.Webview,
    dataUri: string,
    suggestedName: string,
  ): Promise<{ relativePath: string; webviewUri: string }> {
    const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) { throw new Error('Unsupported image data — expected a base64 image data URI.'); }
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const bytes = Buffer.from(match[2], 'base64');

    const assetsDir = assetsDirFor(documentUri);
    await vscode.workspace.fs.createDirectory(assetsDir);

    const slug = suggestedName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]+/g, '-').toLowerCase() || 'image';
    const fileName = `${slug}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const fileUri = vscode.Uri.joinPath(assetsDir, fileName);
    await vscode.workspace.fs.writeFile(fileUri, bytes);

    const dir = path.dirname(documentUri.fsPath);
    const relativePath = path.relative(dir, fileUri.fsPath).split(path.sep).join('/');
    return { relativePath, webviewUri: webview.asWebviewUri(fileUri).toString() };
  }
}
