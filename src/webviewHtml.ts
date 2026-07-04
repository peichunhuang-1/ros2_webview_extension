import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Shared by WebviewPanelProvider (sidebar) and LayoutEditorProvider (custom editor) —
// both mount the same built React bundle, differing only in which root component
// main.tsx picks based on the `data-view` attribute stamped on #root.
export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, view: 'sidebar' | 'layout-editor'): string {
  function findFile(distPath: string, pattern: RegExp) {
    const files = fs.readdirSync(distPath);
    return files.find(f => pattern.test(f));
  }

  const assetsPath = path.join(extensionUri.fsPath, 'media/web-content/dist/assets');
  const scriptFile = findFile(assetsPath, /^index-.*\.js$/);
  const cssFile = findFile(assetsPath, /^index-.*\.css$/);
  if (!scriptFile || !cssFile) {
    throw new Error(`Webview assets not found in ${assetsPath}. Run "npm run build:webview" (or "npm run package") to build media/web-content before packaging the extension.`);
  }

  const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(assetsPath, scriptFile)));
  const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(assetsPath, cssFile)));
  const distUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'web-content', 'dist'));

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <base href="${distUri}/" />
        <script type="module" crossorigin src="${scriptUri}"></script>
        <link rel="stylesheet" crossorigin href="${styleUri}">
      </head>
      <body>
        <div id="root" data-view="${view}"></div>
      </body>
    </html>
  `;
}

export function getWebviewErrorHtml(message: string): string {
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body>
        <p style="font-family: sans-serif; padding: 1em;">Failed to load the ROS2 webview UI: ${message}</p>
      </body>
    </html>
  `;
}
