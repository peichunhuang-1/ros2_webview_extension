// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import WebviewPanelProvider from './WebviewPanelProvider'
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

}

// This method is called when your extension is deactivated
export function deactivate() {}