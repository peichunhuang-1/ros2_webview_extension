import * as vscode from 'vscode';
import { ros2Connection } from './ros2Connection';
import { focusStore, type FocusEntry } from './focusStore';
import { getWebviewHtml, getWebviewErrorHtml } from './webviewHtml';

type SchemaPayload = { pkg: string; name: string };

// One handler per request type the sidebar webview can send (see
// media/web-content/src/ros2_apis/ros2Api.ts for the client side). Each
// handler's return value is posted back as the response for the request's __id.
const requestHandlers: Record<string, (payload: unknown) => unknown | Promise<unknown>> = {
  'ros2/connect':    () => ros2Connection.connect(),
  'ros2/disconnect': () => { ros2Connection.disconnect(); return true; },

  'ros2/schema/msg':    p => { const { pkg, name } = p as SchemaPayload; return ros2Connection.getMsgSchema(pkg, name); },
  'ros2/schema/srv':    p => { const { pkg, name } = p as SchemaPayload; return ros2Connection.getSrvSchema(pkg, name); },
  'ros2/schema/action': p => { const { pkg, name } = p as SchemaPayload; return ros2Connection.getActionSchema(pkg, name); },

  'ros2/interfaces/list': () => ros2Connection.listInterfaces(),
  'ros2/graph/list':      () => ros2Connection.listGraph(),

  'ros2/focus/add':       p => focusStore.add(p as FocusEntry),
  'ros2/focus/remove':    p => focusStore.remove(p as FocusEntry),
  'ros2/focus/setActive': p => focusStore.setActive(p as FocusEntry),
  'ros2/focus/list':      () => focusStore.getState(),
};

export default class WebviewPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'editorWebview';

  constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri,
        vscode.Uri.joinPath(this.extensionUri, 'media', 'web-content', 'dist', 'assets'),
      ],
    };
    try {
      webviewView.webview.html = getWebviewHtml(webviewView.webview, this.extensionUri, 'sidebar');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      webviewView.webview.html = getWebviewErrorHtml(msg);
    }

    webviewView.webview.onDidReceiveMessage(async (e: { type: string; payload?: unknown; __id?: number }) => {
      // All request/response messages carry __id for the promise bridge.
      if (e.__id === undefined) { return; }
      const handler = requestHandlers[e.type];
      if (!handler) { return; }

      try {
        const result = await handler(e.payload);
        void webviewView.webview.postMessage({ __id: e.__id, result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void webviewView.webview.postMessage({ __id: e.__id, error: msg });
      }
    });
  }
}
