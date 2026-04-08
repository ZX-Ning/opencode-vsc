import * as vscode from 'vscode';
import type { ContextChip } from '../../shared/models';

export class WorkspaceContext {
	getActiveFileContext(): ContextChip | null {
		let editor = vscode.window.activeTextEditor;
		if (!editor && vscode.window.visibleTextEditors.length > 0) {
			editor = vscode.window.visibleTextEditors[0];
		}
		if (!editor) return null;

		const path = vscode.workspace.asRelativePath(editor.document.uri);
		return {
			type: 'file',
			path,
			content: editor.document.getText(),
		};
	}

	getSelectionContext(): ContextChip | null {
		let editor = vscode.window.activeTextEditor;
		if (!editor && vscode.window.visibleTextEditors.length > 0) {
			editor = vscode.window.visibleTextEditors[0];
		}
		if (!editor || editor.selection.isEmpty) return null;

		const path = vscode.workspace.asRelativePath(editor.document.uri);
		const selection = editor.selection;
		return {
			type: 'selection',
			path,
			range: {
				startLine: selection.start.line + 1,
				endLine: selection.end.line + 1
			},
			content: editor.document.getText(selection)
		};
	}
}
