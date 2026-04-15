/*
 * Owns the sidebar webview, bridges host and webview messages, and lazily hydrates session data.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { HostMessage, WebviewMessage } from "../../shared/protocol";
import type {
  ContextChip,
  DraftOptions,
  DraftSelection,
  SessionState,
  SessionStatusState,
} from "../../shared/models";
import type {
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@opencode-ai/sdk/v2/client";
import { Client } from "../opencode/client";
import { EventStream } from "../opencode/event-stream";
import { ProcessManager } from "../opencode/process-manager";
import { SessionStore } from "../opencode/session-store";
import { WorkspaceContext } from "../vscode/workspace-context";
import { getWebviewHtml } from "./html";
import { DraftStore } from "./draft-store";

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly workspace = new WorkspaceContext();
  private readonly draft = new DraftStore();
  private contextChips: ContextChip[] = [];
  private error?: string;
  private ready = false;
  private suspendStorePosts = 0;
  private snapshotTimer?: NodeJS.Timeout;
  private hydratedSessions = new Set<string>();
  private hostAcked = false;
  private htmlRefreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly proc: ProcessManager,
    private readonly client: Client,
    private readonly events: EventStream,
    private readonly store: SessionStore,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.proc.on("statusChange", () => {
      this.postConnection();
      if (this.proc.status === "running" && this.ready) {
        void this.bootstrap();
      }
    });

    this.events.on("error", (err) => {
      this.error = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", payload: { message: this.error } });
    });

    this.store.on("change", () => {
      void this.context.workspaceState.update("activeSessionId", this.store.activeSessionId);
      if (this.suspendStorePosts > 0) return;
      this.scheduleSnapshotPost();
    });
  }

  /** Initializes each resolved sidebar instance and rebinds view-local listeners. */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext<unknown>,
  ) {
    this.view = webviewView;
    this.ready = false;
    this.hostAcked = false;
    this.proc.log("Sidebar resolveWebviewView");

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };

    webviewView.webview.html = getWebviewHtml(
      webviewView.webview,
      this.extensionUri,
      this.viewState(),
    );

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      this.proc.log(`Sidebar received message: ${msg.type}`);
      try {
        await this.handle(msg);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.proc.log(`Sidebar handle error: ${message}`);
        this.post({ type: "error", payload: { message } });
      }
    });

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.proc.log("Sidebar disposed");
        this.view = undefined;
        this.ready = false;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      this.proc.log(`Sidebar visibility changed visible=${webviewView.visible}`);
      if (webviewView.visible && this.ready) {
        this.post({
          type: "bootstrap",
          payload: {
            connectionStatus: this.connectionStatus(),
            ...this.store.snapshot,
            draft: this.draft.snapshot,
          },
        });
      }
    });

    this.proc.log(`Sidebar resolve restoredState=${context.state ? "yes" : "no"}`);
  }

  /** Dispatches webview messages into host-side actions and state updates. */
  private async handle(msg: WebviewMessage) {
    switch (msg.type) {
      case "ready":
        this.ready = true;
        this.proc.log("Sidebar ready acknowledged");
        this.postConnection();
        await this.bootstrap();
        return;
      case "debug.log":
        this.proc.log(`Webview ${msg.payload.message}`);
        return;
      case "host.ack":
        this.hostAcked = true;
        this.proc.log(`Sidebar host ack ${msg.payload.messageType}`);
        return;
      case "session.new":
        await this.createSession();
        return;
      case "session.switch":
        this.store.activeSessionId = msg.payload.sessionID;
        this.syncDraftFromSession();
        this.postDraft();
        this.flushSnapshotPost();
        void this.ensureSessionLoaded(msg.payload.sessionID);
        return;
      case "session.archive":
        await this.archiveSession(msg.payload.sessionID);
        return;
      case "draft.set":
        this.draft.setSelection(msg.payload);
        this.postDraft();
        return;
      case "context.sync":
        this.contextChips = msg.payload.chips.map((chip) => ({
          type: chip.type,
          path: chip.path,
          range: chip.range
            ? {
                startLine: chip.range.startLine,
                endLine: chip.range.endLine,
              }
            : undefined,
          content: chip.content,
        }));
        return;
      case "prompt.send":
        await this.sendPrompt(msg.payload.text, msg.payload.attachments, msg.payload.draft);
        return;
      case "session.abort":
        await this.abort(msg.payload.sessionID);
        return;
      case "session.compact":
        await this.compact(msg.payload.sessionID);
        return;
      case "turn.revert":
        await this.revert(msg.payload.sessionID, msg.payload.messageID);
        return;
      case "permission.approve":
        await this.client.replyPermission(msg.payload.requestID, msg.payload.remember);
        return;
      case "permission.deny":
        await this.client.rejectPermission(msg.payload.requestID);
        return;
      case "question.answer":
        await this.client.replyQuestion(msg.payload.requestID, msg.payload.answers);
        return;
      case "context.attachActiveFile": {
        const item = this.workspace.getActiveFileContext();
        if (item) {
          this.contextChips = [...this.contextChips, item];
          this.post({ type: "context.preview", payload: item });
        } else {
          this.post({ type: "error", payload: { message: "No active editor found to attach" } });
        }
        return;
      }
      case "context.attachSelection": {
        const item = this.workspace.getSelectionContext();
        if (item) {
          this.contextChips = [...this.contextChips, item];
          this.post({ type: "context.preview", payload: item });
        } else {
          this.post({ type: "error", payload: { message: "No selection found in active editor" } });
        }
        return;
      }
      case "file.open":
        await this.openFile(msg.payload.sessionID, msg.payload.path);
        return;
      case "diff.open":
        await this.openDiff(msg.payload.sessionID, msg.payload.path);
        return;
    }
  }

  private bootstrapPromise?: Promise<void>;

  /** Deduplicates concurrent bootstrap attempts triggered by ready/status changes. */
  private bootstrap() {
    if (this.bootstrapPromise) return this.bootstrapPromise;

    this.bootstrapPromise = this.runBootstrap().finally(() => {
      this.bootstrapPromise = undefined;
    });

    return this.bootstrapPromise;
  }

  /** Reloads lightweight session lists, restores draft state, and hydrates the active session on demand. */
  private async runBootstrap() {
    this.proc.log("Sidebar bootstrap start");
    const directory = this.root();
    const knownStatus = new Map(
      this.store.snapshot.sessions.map(
        (session) => [session.info.id, this.toSdkStatus(session.status)] as const,
      ),
    );

    if (!directory) {
      this.withSuspendedStorePosts(() => {
        this.store.bootstrap();
        this.hydratedSessions.clear();
      });
      this.error = "Open a workspace folder to use OpenCode.";
      this.post({
        type: "bootstrap",
        payload: {
          connectionStatus: this.connectionStatus(),
          ...this.store.snapshot,
          draft: this.draft.snapshot,
        },
      });
      this.post({ type: "error", payload: { message: this.error } });
      return;
    }

    await this.loadDraft(directory);
    this.proc.log(`Sidebar loadSessions directory=${directory}`);
    const sessions = await this.client.getSessions(directory);
    this.withSuspendedStorePosts(() => {
      this.store.bootstrap();
      this.hydratedSessions.clear();
      for (const session of sessions) {
        this.store.upsertSession(session, { status: knownStatus.get(session.id) });
      }

      const saved = this.context.workspaceState.get<string>("activeSessionId");
      if (saved && this.store.getSession(saved)) this.store.activeSessionId = saved;
      if (!this.store.activeSessionId && sessions[0]) this.store.activeSessionId = sessions[0].id;
    });

    this.error = undefined;
    this.post({
      type: "bootstrap",
      payload: {
        connectionStatus: this.connectionStatus(),
        ...this.store.snapshot,
        draft: this.draft.snapshot,
      },
    });

    if (this.store.activeSessionId) {
      await this.ensureSessionLoaded(this.store.activeSessionId);
    }
  }

  /** Creates a new session in the current workspace and switches the sidebar to it. */
  private async createSession() {
    const directory = this.root();
    if (!directory) {
      this.error = "Open a workspace folder to create a session.";
      this.post({ type: "error", payload: { message: this.error } });
      return;
    }

    this.proc.log(`Sidebar createSession directory=${directory}`);
    const info = await this.client.createSession(directory);
    if (!info) return;

    this.withSuspendedStorePosts(() => {
      this.store.upsertSession(info);
      this.store.activeSessionId = info.id;
    });
    this.syncDraftFromSession();
    this.postDraft();
    this.flushSnapshotPost();
    await this.ensureSessionLoaded(info.id);
  }

  /** Archives a session, updates local state immediately, and chooses the next active session. */
  private async archiveSession(sessionID: string) {
    const session = this.store.getSession(sessionID);
    if (!session) return;

    await this.client.archiveSession(sessionID, session.info.directory);

    this.withSuspendedStorePosts(() => {
      this.store.removeSession(sessionID);
      if (!this.store.activeSessionId) {
        const next = this.store.snapshot.sessions[0];
        if (next) this.store.activeSessionId = next.info.id;
      }
      this.hydratedSessions.delete(sessionID);
    });

    this.syncDraftFromSession();
    this.postDraft();
    this.flushSnapshotPost();

    if (this.store.activeSessionId) {
      void this.ensureSessionLoaded(this.store.activeSessionId);
    }
  }

  /** Creates a session if needed, sends the prompt, and clears attached context chips afterward. */
  private async sendPrompt(text: string, attachments: ContextChip[], draft?: DraftSelection) {
    if (!text.trim()) return;
    this.proc.log(`Sidebar sendPrompt chars=${text.length} attachments=${attachments.length}`);

    let sessionID = this.store.activeSessionId;
    if (!sessionID) {
      await this.createSession();
      sessionID = this.store.activeSessionId;
    }
    if (!sessionID) return;

    const session = this.store.getSession(sessionID);
    if (!session) return;

    this.draft.setSelection(draft ?? this.draft.snapshot.selection);
    await this.client.sendPrompt(
      sessionID,
      session.info.directory,
      text,
      attachments,
      this.draft.snapshot.selection,
    );
    this.contextChips = [];
    this.error = undefined;
    this.postDraft();
  }

  private async abort(sessionID: string) {
    const session = this.store.getSession(sessionID);
    if (!session) return;
    await this.client.abortRun(sessionID, session.info.directory);
  }

  private async compact(sessionID: string) {
    const session = this.store.getSession(sessionID);
    if (!session) return;

    const sessionModel = this.draft.snapshot.selection.model;
    await this.client.compactSession(sessionID, session.info.directory, sessionModel);
  }

  private async revert(sessionID: string, messageID: string) {
    const session = this.store.getSession(sessionID);
    if (!session) return;
    await this.client.revertTurn(sessionID, session.info.directory, messageID);
  }

  /** Hydrates the full server-side state needed to render a session transcript. */
  private async loadSession(sessionID: string, directory: string): Promise<LoadedSession> {
    this.proc.log(`Sidebar loadSession session=${sessionID} directory=${directory}`);
    const [info, messages, diffs, todos, permissions, questions] = await Promise.all([
      this.client.getSession(sessionID, directory),
      this.client.getMessages(sessionID, directory),
      this.client.getDiff(sessionID, directory),
      this.client.getTodos(sessionID, directory),
      this.client.getPendingPermissions(directory),
      this.client.getPendingQuestions(directory),
    ]);

    if (!info) throw new Error(`Session ${sessionID} not found`);

    return {
      info,
      status: this.toSdkStatus(this.store.getSession(sessionID)?.status),
      messages: (messages ?? []).map((item) => ({ info: item.info, parts: item.parts })),
      todos: todos ?? [],
      pendingPermissions: (permissions ?? []).filter((item) => item.sessionID === sessionID),
      pendingQuestions: (questions ?? []).filter((item) => item.sessionID === sessionID),
      diffs: diffs ?? [],
    };
  }

  /** Loads provider and agent catalog data before restoring the current draft selection. */
  private async loadDraft(directory: string) {
    const [providers, agents, defaultAgent] = await Promise.all([
      this.client.getProviders(directory),
      this.client.getAgents(directory),
      this.client.getDefaultAgent(directory),
    ]);
    this.draft.setCatalog({
      providers: providers.providers,
      defaults: providers.defaults,
      agents,
      defaultAgent,
    });
    this.syncDraftFromSession();
  }

  /** Rebuilds the draft selection from the currently active session, if one exists. */
  private syncDraftFromSession() {
    const sessionID = this.store.activeSessionId;
    const session = sessionID ? this.store.getSession(sessionID) : undefined;
    this.draft.restore(session);
  }

  /** Lazily fetches heavy per-session data the first time a session becomes active. */
  private async ensureSessionLoaded(sessionID: string) {
    if (this.hydratedSessions.has(sessionID)) return;
    const session = this.store.getSession(sessionID);
    if (!session) return;

    const full = await this.loadSession(sessionID, session.info.directory);
    this.withSuspendedStorePosts(() => {
      this.store.upsertSession(full.info, {
        status: full.status,
        todos: full.todos,
        pendingPermissions: full.pendingPermissions,
        pendingQuestions: full.pendingQuestions,
        diffs: full.diffs,
      });
      this.store.setMessages(full.info.id, full.messages);
      this.hydratedSessions.add(sessionID);
    });

    if (this.store.activeSessionId === sessionID) {
      this.syncDraftFromSession();
      this.postDraft();
    }
    this.flushSnapshotPost();
  }

  /** Maps process state into the smaller connection enum exposed to the webview. */
  private connectionStatus() {
    if (this.proc.status === "running") return "connected" as const;
    if (this.proc.status === "starting") return "connecting" as const;
    if (this.proc.status === "error") return "error" as const;
    return "disconnected" as const;
  }

  /** Posts the latest connection state so the webview can render startup and error transitions. */
  private postConnection() {
    this.error = this.proc.error ?? undefined;
    this.post({
      type: "connection.state",
      payload: {
        status: this.connectionStatus(),
        error: this.proc.error,
      },
    });
  }

  private postDraft() {
    this.post({ type: "draft.state", payload: this.draft.snapshot });
  }

  /** Coalesces frequent store updates into a smaller stream of snapshot messages. */
  private scheduleSnapshotPost() {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      this.post({ type: "session.snapshot", payload: this.store.snapshot });
    }, 50);
  }

  /** Flushes the latest snapshot immediately when the UI needs a synchronous refresh. */
  private flushSnapshotPost() {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
    this.post({ type: "session.snapshot", payload: this.store.snapshot });
  }

  /** Suppresses intermediate snapshot posts while a larger state update is being applied. */
  private withSuspendedStorePosts<T>(fn: () => T) {
    this.suspendStorePosts += 1;
    try {
      return fn();
    } finally {
      this.suspendStorePosts -= 1;
    }
  }

  /** Produces the HTML bootstrap state used by the initial render and fallback refreshes. */
  private viewState() {
    return {
      connectionStatus: this.connectionStatus(),
      ...this.store.snapshot,
      draft: this.draft.snapshot,
      contextChips: this.contextChips,
      error: this.error,
    };
  }

  /** Chooses the workspace root using the same precedence documented for this extension. */
  private root() {
    const folders = vscode.workspace.workspaceFolders;
    if (folders?.length) return folders[0]?.uri.fsPath;

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath;
      if (folder) return folder;
    }

    const envRoot = process.env.OPENCODE_WORKSPACE_ROOT;
    if (envRoot && fs.existsSync(envRoot)) return envRoot;

    return undefined;
  }

  /** Opens a session-relative file safely and rejects paths that escape the workspace root. */
  private async openFile(sessionID: string, rel: string) {
    const session = this.store.getSession(sessionID);
    if (!session) return;

    const match = rel.match(/^(.*?)(?::(\d+)(?::(\d+))?)?$/);
    const rawPath = match?.[1] ?? rel;
    const line = match?.[2];
    const column = match?.[3];
    const root = fs.realpathSync(session.info.directory);
    const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized) throw new Error("File path is empty");
    if (normalized.startsWith("../") || path.isAbsolute(normalized)) {
      throw new Error(`File path is outside the session root: ${rel}`);
    }

    const resolved = path.resolve(root, normalized);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${rawPath}`);
    }

    const target = fs.realpathSync(resolved);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`File path is outside the session root: ${rel}`);
    }

    const stats = fs.statSync(target);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${rawPath}`);
    }

    const uri = vscode.Uri.file(target);
    const document = await vscode.workspace.openTextDocument(uri);
    const selection = line
      ? new vscode.Selection(
          Math.max(0, Number(line) - 1),
          Math.max(0, Number(column ?? "1") - 1),
          Math.max(0, Number(line) - 1),
          Math.max(0, Number(column ?? "1") - 1),
        )
      : undefined;
    await vscode.window.showTextDocument(document, {
      preview: false,
      selection,
    });
  }

  /** Builds a temporary before/after view from unified diff text when a real patch is available. */
  private async openDiff(sessionID: string, rel: string) {
    const session = this.store.getSession(sessionID);
    if (!session) return;

    const diff = session.diffs.find((item) => item.file === rel);
    if (!diff?.patch) {
      await this.openFile(sessionID, rel);
      return;
    }

    const title = `${path.basename(rel)} (OpenCode Diff)`;
    const before = await vscode.workspace.openTextDocument({
      content: this.extractOriginalContent(diff.patch),
    });
    const after = await vscode.workspace.openTextDocument({
      content: this.extractModifiedContent(diff.patch),
    });

    await vscode.commands.executeCommand("vscode.diff", before.uri, after.uri, title, {
      preview: false,
    });
  }

  /** Sends a host message to the webview and falls back to HTML refresh if acknowledgements never arrive. */
  private post(message: HostMessage) {
    if (!this.view || (!this.ready && message.type !== "bootstrap" && message.type !== "error"))
      return;
    this.proc.log(`Sidebar post message: ${message.type}`);
    void this.view.webview.postMessage(message).then((ok) => {
      this.proc.log(`Sidebar post delivered=${ok}`);
    });

    if (
      !this.hostAcked &&
      (message.type === "bootstrap" ||
        message.type === "connection.state" ||
        message.type === "session.snapshot")
    ) {
      this.scheduleHtmlRefresh();
    }
  }

  /** Refreshes the full HTML shell as a compatibility fallback for missing host acknowledgements. */
  private scheduleHtmlRefresh() {
    if (this.htmlRefreshTimer || !this.view) return;
    this.htmlRefreshTimer = setTimeout(() => {
      this.htmlRefreshTimer = undefined;
      if (!this.view || this.hostAcked) return;
      this.proc.log("Sidebar fallback html refresh");
      this.view.webview.html = getWebviewHtml(
        this.view.webview,
        this.extensionUri,
        this.viewState(),
      );
    }, 250);
  }

  /** Restores the SDK status shape from the lighter state mirrored into the webview. */
  private toSdkStatus(status?: SessionStatusState): SessionStatus {
    if (!status || status.type === "idle") return { type: "idle" };
    if (status.type === "busy") return { type: "busy" };
    return {
      type: "retry",
      attempt: status.attempt,
      message: status.message,
      next: status.next,
    };
  }

  private extractOriginalContent(patch: string) {
    return this.applyUnifiedDiff(patch, "before");
  }

  private extractModifiedContent(patch: string) {
    return this.applyUnifiedDiff(patch, "after");
  }

  /** Reconstructs one side of a unified diff for the built-in VS Code diff view. */
  private applyUnifiedDiff(patch: string, side: "before" | "after") {
    const lines = patch.split(/\r?\n/);
    const output: string[] = [];

    for (const line of lines) {
      if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("@@")) continue;
      if (line.startsWith("\\ No newline at end of file")) continue;

      if (line.startsWith("+")) {
        if (side === "after") output.push(line.slice(1));
        continue;
      }

      if (line.startsWith("-")) {
        if (side === "before") output.push(line.slice(1));
        continue;
      }

      if (line.startsWith(" ")) {
        output.push(line.slice(1));
        continue;
      }
    }

    return output.join("\n");
  }
}

type LoadedSession = {
  info: Session;
  status: SessionStatus;
  messages: Array<{ info: Message; parts: Part[] }>;
  todos: Todo[];
  pendingPermissions: PermissionRequest[];
  pendingQuestions: QuestionRequest[];
  diffs: SnapshotFileDiff[];
};
