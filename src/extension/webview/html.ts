import * as vscode from 'vscode';
import type { BootstrapPayload } from '../../shared/protocol';
import type { ContextChip } from '../../shared/models';

export type WebviewState = BootstrapPayload & {
  contextChips: ContextChip[];
  error?: string;
};

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, state: WebviewState) {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.css'));
  const nonce = getNonce();
  const payload = JSON.stringify(state).replace(/</g, '\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
    <link href="${styleUri}" rel="stylesheet">
    <title>OpenCode</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}">window.__OPENCODE_INITIAL_STATE__ = ${payload};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
