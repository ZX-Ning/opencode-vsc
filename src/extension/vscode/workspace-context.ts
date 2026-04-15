/*
 * Reads VS Code editor state and turns it into attachable OpenCode context chips.
 */
import * as vscode from "vscode";
import type { ContextChip } from "../../shared/models";

export class WorkspaceContext {
  /** Falls back from the active editor to any visible editor so attach actions remain usable. */
  private activeEditor() {
    let editor = vscode.window.activeTextEditor;
    if (!editor && vscode.window.visibleTextEditors.length > 0) {
      editor = vscode.window.visibleTextEditors[0];
    }
    return editor;
  }

  /** Converts VS Code's selection semantics into the inclusive line range shown in the UI. */
  private selectionRange(selection: vscode.Selection) {
    const startLine = selection.start.line + 1;
    const rawEndLine = selection.isSingleLine
      ? selection.end.line + 1
      : selection.end.character === 0
        ? selection.end.line
        : selection.end.line + 1;

    return {
      startLine,
      endLine: Math.max(startLine, rawEndLine),
    };
  }

  /** Returns the active file as a relative context chip. */
  getActiveFileContext(): ContextChip | null {
    const editor = this.activeEditor();
    if (!editor) return null;

    const path = vscode.workspace.asRelativePath(editor.document.uri);
    return {
      type: "file",
      path,
    };
  }

  /** Returns the current selection as a relative context chip with 1-based line numbers. */
  getSelectionContext(): ContextChip | null {
    const editor = this.activeEditor();
    if (!editor || editor.selection.isEmpty) return null;

    const path = vscode.workspace.asRelativePath(editor.document.uri);
    return {
      type: "selection",
      path,
      range: this.selectionRange(editor.selection),
    };
  }
}
