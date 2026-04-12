import * as vscode from 'vscode';
import type { ContextChip } from '../../shared/models';

export class WorkspaceContext {
	private activeEditor() {
		let editor = vscode.window.activeTextEditor;
		if (!editor && vscode.window.visibleTextEditors.length > 0) {
			editor = vscode.window.visibleTextEditors[0];
		}
		return editor;
	}

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

	getActiveFileContext(): ContextChip | null {
		const editor = this.activeEditor();
		if (!editor) return null;

		const path = vscode.workspace.asRelativePath(editor.document.uri);
		return {
			type: 'file',
			path,
		};
	}

	getSelectionContext(): ContextChip | null {
		const editor = this.activeEditor();
		if (!editor || editor.selection.isEmpty) return null;

		const path = vscode.workspace.asRelativePath(editor.document.uri);
		return {
			type: 'selection',
			path,
			range: this.selectionRange(editor.selection),
		};
	}
}
