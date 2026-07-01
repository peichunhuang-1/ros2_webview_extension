import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ros2Connection } from './ros2Connection';
import { focusStore, type FocusEntry } from './focusStore';


export default class WebviewPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'editorWebview';
  public _view?: vscode.WebviewView;
  private events: ((e: MessageEvent) => void)[] = [];
  private listening = false;
  constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }
  
  createOperationEventCallback() {
    return async (e: { type: string; payload?: unknown; __id?: number }) => {

      // All request/response messages carry __id for the promise bridge.
      if (e.__id === undefined) { return; }
      const id = e.__id;

      try {
        let result: unknown;

        if (e.type === 'ros2/connect') {
          result = ros2Connection.connect();

        } else if (e.type === 'ros2/disconnect') {
          ros2Connection.disconnect();
          result = true;

        } else if (e.type === 'ros2/schema/msg') {
          const { pkg, name } = e.payload as { pkg: string; name: string };
          result = await ros2Connection.getMsgSchema(pkg, name);

        } else if (e.type === 'ros2/schema/srv') {
          const { pkg, name } = e.payload as { pkg: string; name: string };
          result = await ros2Connection.getSrvSchema(pkg, name);

        } else if (e.type === 'ros2/schema/action') {
          const { pkg, name } = e.payload as { pkg: string; name: string };
          result = await ros2Connection.getActionSchema(pkg, name);

        } else if (e.type === 'ros2/interfaces/list') {
          result = ros2Connection.listInterfaces();

        } else if (e.type === 'ros2/focus/add') {
          result = focusStore.add(e.payload as FocusEntry);

        } else if (e.type === 'ros2/focus/remove') {
          result = focusStore.remove(e.payload as FocusEntry);

        } else if (e.type === 'ros2/focus/setActive') {
          result = focusStore.setActive(e.payload as FocusEntry);

        } else if (e.type === 'ros2/focus/list') {
          result = focusStore.getState();

        } else {
          return;
        }

        this._view?.webview.postMessage({ __id: id, result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._view?.webview.postMessage({ __id: id, error: msg });
      }
    };
  }

  registEvent(func: (e: MessageEvent) => void) {
    this.events.push(func);
  }

  removeEvent(func: (e: MessageEvent) => void) {
    this.events = this.events.filter(f => f !== func);
  }

  public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [
            this._extensionUri,
            vscode.Uri.joinPath(this._extensionUri, 'media', 'web-content', 'dist', 'assets')
        ]
      };
      webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
      this._view = webviewView;
      if (this.listening) {
        return;
      }
      this.listening = true;
      this._view.webview.onDidReceiveMessage((e)=>{
        this.events.forEach(call => call(e));
      });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    function findFile(distPath: string, pattern: RegExp) {
      const files = fs.readdirSync(distPath);
      return files.find(f => pattern.test(f));
    }

    const assetsPath = path.join(this._extensionUri.fsPath, 'media/web-content/dist/assets');
    const scriptFile = findFile(assetsPath, /^index-.*\.js$/);
    const cssFile = findFile(assetsPath, /^index-.*\.css$/);

    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(assetsPath, scriptFile!)));
    const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(assetsPath, cssFile!)));

    const distUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'web-content', 'dist'));
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
          <div id="root"></div>
        </body>
      </html>
    `;
  }
};