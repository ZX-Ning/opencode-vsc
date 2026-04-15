/*
 * Builds the sidebar webview HTML shell and injects the minimal bootstrap payload.
 */
import { randomBytes } from "crypto";
import * as vscode from "vscode";
import type { BootstrapPayload } from "../../shared/protocol";
import type { ContextChip } from "../../shared/models";

export type WebviewState = BootstrapPayload & {
  contextChips: ContextChip[];
  error?: string;
};

/** Creates the full HTML document for a resolved webview instance. */
export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  state: WebviewState,
) {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "main.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "main.css"),
  );
  const nonce = getNonce();
  const payload = JSON.stringify(state).replace(/</g, "\u003c");

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

/** Generates a CSP nonce for the inline bootstrap script and bundle tag. */
function getNonce() {
  return randomBytes(16).toString("base64");
}
