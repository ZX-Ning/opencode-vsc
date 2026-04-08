import * as vscode from 'vscode';
import type { ContextChip } from '../../shared/models';

export class WorkspaceContext {
	getActiveFileContext(): ContextChip | null {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return null;

		const path = vscode.workspace.asRelativePath(editor.document.uri);
		return {
			type: 'file',
			path,
			content: editor.document.getText(),
		};
	}

	getSelectionContext(): ContextChip | null {
		const editor = vscode.window.activeTextEditor;
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
