/*
 * Serves raw OpenCode message payloads as readonly virtual JSON documents.
 */
import * as vscode from "vscode";

export class RawMessageDocumentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "opencode-message";

  private readonly contents = new Map<string, string>();
  private readonly changes = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.changes.event;

  uri(sessionID: string, messageID: string) {
    return vscode.Uri.from({
      scheme: RawMessageDocumentProvider.scheme,
      path: `/${sessionID}/message-${messageID}.json`,
    });
  }

  update(uri: vscode.Uri, content: string) {
    this.contents.set(uri.toString(), content);
    this.changes.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri) {
    return this.contents.get(uri.toString()) ?? "";
  }
}
