/*
 * Serves OpenCode patch components as readonly virtual documents for diffing.
 */
import * as vscode from "vscode";

export class DiffDocumentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "opencode-diff";

  private readonly contents = new Map<string, string>();
  private readonly changes = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.changes.event;

  uri(sessionID: string, type: "before" | "after", rel: string) {
    return vscode.Uri.from({
      scheme: DiffDocumentProvider.scheme,
      path: `/${sessionID}/${type}/${rel}`,
    });
  }

  update(uri: vscode.Uri, content: string) {
    this.contents.set(uri.toString(), content);
    this.changes.fire(uri);
  }

  delete(uri: vscode.Uri) {
    this.contents.delete(uri.toString());
  }

  provideTextDocumentContent(uri: vscode.Uri) {
    return this.contents.get(uri.toString()) ?? "";
  }
}
