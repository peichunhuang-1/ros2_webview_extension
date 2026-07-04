import * as vscode from 'vscode';
import * as path from 'path';

// Matches src="..."/href="..." that point at a local relative asset (not a URL, data URI, anchor, etc.).
const ASSET_ATTR_RE = /\b(src|href)=(["'])(?!https?:|\/\/|data:|#|vscode-webview:)([^"']+)\2/g;

export class PreviewPanelManager {
  private panels = new Map<string, vscode.WebviewPanel>();
  private watchers = new Map<string, vscode.FileSystemWatcher>();

  async open(htmlUri: vscode.Uri): Promise<void> {
    const key = htmlUri.toString();
    let panel = this.panels.get(key);

    if (!panel) {
      const dir = vscode.Uri.file(path.dirname(htmlUri.fsPath));
      panel = vscode.window.createWebviewPanel(
        'ros2GuiPreview',
        `Preview: ${path.basename(htmlUri.fsPath)}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [dir] },
      );
      this.panels.set(key, panel);

      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, '**/*'));
      const reload = () => { void this.render(panel!, htmlUri); };
      watcher.onDidChange(reload);
      watcher.onDidCreate(reload);
      this.watchers.set(key, watcher);

      panel.onDidDispose(() => {
        this.panels.delete(key);
        this.watchers.get(key)?.dispose();
        this.watchers.delete(key);
      });
    } else {
      panel.reveal(vscode.ViewColumn.Beside);
    }

    await this.render(panel, htmlUri);
  }

  private async render(panel: vscode.WebviewPanel, htmlUri: vscode.Uri): Promise<void> {
    const dir = vscode.Uri.file(path.dirname(htmlUri.fsPath));
    const bytes = await vscode.workspace.fs.readFile(htmlUri);
    let html = Buffer.from(bytes).toString('utf8');

    html = html.replace(ASSET_ATTR_RE, (_match: string, attr: string, quote: string, relPath: string) => {
      const assetUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(dir, relPath));
      return `${attr}=${quote}${assetUri.toString()}${quote}`;
    });

    // Content is locally authored (by the user or Claude), so the CSP here just scopes
    // script/style/connect sources to this one panel rather than trying to sandbox untrusted content.
    //
    // No frame-src: an earlier design that composed a generated GUI's panels via one
    // <iframe> per panel was dropped after repeated CSP failures, since a cross-document
    // iframe navigation to a local file gets its own pseudo-origin in a VS Code webview
    // that doesn't treat sibling resources as same-origin the way a normal web server would.
    const csp = [
      `default-src 'none'`,
      `img-src ${panel.webview.cspSource} https: data:`,
      `style-src ${panel.webview.cspSource} 'unsafe-inline' https:`,
      `font-src ${panel.webview.cspSource} https:`,
      `script-src ${panel.webview.cspSource} 'unsafe-inline' https:`,
      `connect-src * ws: wss:`,
    ].join('; ');
    const cspTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

    html = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, match => `${match}\n${cspTag}`)
      : `${cspTag}\n${html}`;

    panel.webview.html = html;
  }
}
