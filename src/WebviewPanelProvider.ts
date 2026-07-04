import * as vscode from 'vscode';
import { ros2Connection } from './ros2Connection';
import { focusStore, type FocusEntry } from './focusStore';
import { getWebviewHtml, getWebviewErrorHtml } from './webviewHtml';


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

        } else if (e.type === 'ros2/graph/list') {
          result = await ros2Connection.listGraph();

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
      try {
        webviewView.webview.html = getWebviewHtml(webviewView.webview, this._extensionUri, 'sidebar');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        webviewView.webview.html = getWebviewErrorHtml(msg);
      }
      this._view = webviewView;
      if (this.listening) {
        return;
      }
      this.listening = true;
      this._view.webview.onDidReceiveMessage((e)=>{
        this.events.forEach(call => call(e));
      });
  }

};