/*
 * Activates the VS Code extension and wires together the host-side OpenCode services.
 */
import * as vscode from "vscode";
import { Client } from "./opencode/client";
import { EventStream } from "./opencode/event-stream";
import { ProcessManager } from "./opencode/process-manager";
import { SessionStore } from "./opencode/session-store";
import { RawMessageDocumentProvider } from "./vscode/raw-message-document-provider";
import { SidebarProvider } from "./webview/sidebar-provider";

/**
 * Builds the host-side runtime graph, registers VS Code entry points, and starts the managed server.
 */
export function activate(context: vscode.ExtensionContext) {
  const proc = new ProcessManager();
  const client = new Client(proc);
  const store = new SessionStore();
  const events = new EventStream(proc, client);
  const rawMessages = new RawMessageDocumentProvider();
  const sidebar = new SidebarProvider(
    context.extensionUri,
    proc,
    client,
    events,
    store,
    rawMessages,
    context,
  );

  proc.log("Extension activate");

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      RawMessageDocumentProvider.scheme,
      rawMessages,
    ),
    vscode.window.registerWebviewViewProvider("opencode.sidebar", sidebar),
  );

  events.on("event", (event) => {
    proc.log(`Extension received event: ${event.payload.type}`);
    store.handleEvent(event);
  });

  events.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showWarningMessage(`OpenCode event stream error: ${msg}`);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.focus", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.opencode-sidebar");
      await vscode.commands.executeCommand("opencode.sidebar.focus");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.openCliPathSettings", async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", "opencode.cli.path");
    }),
  );

  void (async () => {
    try {
      await proc.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const choice = await vscode.window.showErrorMessage(
        `Failed to start OpenCode server: ${msg}`,
        "Open CLI Path Setting",
        "Open Output",
      );
      if (choice === "Open CLI Path Setting") {
        await vscode.commands.executeCommand("opencode.openCliPathSettings");
      }
      if (choice === "Open Output") {
        await vscode.commands.executeCommand("workbench.action.output.toggleOutput");
      }
    }
  })();

  context.subscriptions.push({
    dispose: () => {
      proc.stop();
    },
  });
}

export function deactivate() {}
