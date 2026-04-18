# Codebase Review — 2026-04-17

Scope: full line-by-line review of `src/`, build configuration, manifest, docs, and
supporting files for the `opencode-vsc` VS Code extension (v0.3.1).

Sections:

1. Summary
2. Bugs and correctness issues (ranked)
3. Security / vulnerability observations
4. Code quality and best practices
5. Redundant code, config, and docs
6. Possible improvements / suggestions
7. File-by-file notes

---

## 1. Summary

Overall the codebase is small, well-organized, and follows a clean host/webview
boundary with typed DTOs in `src/shared/`. Error paths are generally handled, and
the managed-server workflow is thoughtful (random port, random auth password,
graceful exits). The Solid webview keeps local-only UI state and mirrors host
snapshots correctly.

There are, however, several real correctness issues worth addressing, a few
security hardening opportunities, and meaningful amounts of cleanup/redundancy
(duplicate `.vsix` artifacts in-tree, legacy docs, duplicate `status-row` class
usage, repetitive DTO mapping, etc.). None of the findings are critical, but
fixing the high-ranked bugs will materially improve reliability.

---

## 2. Bugs and correctness issues (ranked by impact)

### B1. `applyUnifiedDiff` loses content between hunks (`sidebar-provider.ts:706-731`)

```ts
private applyUnifiedDiff(patch: string, side: "before" | "after") {
  ...
  for (const line of lines) {
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("@@")) continue;
    ...
  }
}
```

The hunk headers (`@@ -a,b +c,d @@`) are skipped entirely. For patches that
contain **multiple hunks** the unchanged lines between hunks are silently
dropped, producing a "before" / "after" file that looks shorter than reality
and misaligns VS Code's diff view for large changes. The reconstructed content
is therefore not suitable as a real before/after representation for any
non-trivial file.

**Suggested fix**: either (a) use the original file on disk for the "before"
side (when `status !== "added"`) and only reconstruct "after", or (b) parse the
hunk header offsets and synthesize the file using the known original/new line
counts, or (c) rely on VS Code's built-in diff on real on-disk files and only
use the reconstructed view as a fallback.

### B2. `openFile` regex splits Windows absolute paths incorrectly (`sidebar-provider.ts:562-571`)

```ts
const match = rel.match(/^(.*?)(?::(\d+)(?::(\d+))?)?$/);
```

The non-greedy `(.*?)` before `:\d+` can grab `C` and treat `\Users\...` as a
line number for inputs like `C:\foo\bar.ts`. The guard
`path.isAbsolute(normalized)` rejects absolute paths later, but the parse itself
is still wrong, and if a transcript link passes `C:/foo.ts:12:3` the path will
become `C` and line/column parsed from user data.

**Suggested fix**: anchor on `.+?` only followed by `:\d+(:\d+)?$` and ensure
line/column suffixes consist solely of trailing digits. A simpler and safer
approach: split from the right:

```ts
const m = rel.match(/^(.+?)(?::(\d+)(?::(\d+))?)?$/);
```

plus explicit bail-out if `rel` looks like `<letter>:...` on Windows.

### B3. Enter-to-send ignores IME composition (`composer.tsx:124-129`)

```ts
onKeyDown={(e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}}
```

Users typing in CJK / IME will have Enter consumed mid-composition. Check
`e.isComposing` (or `e.keyCode === 229`) and return early.

### B4. Delta buffer mutation loses fields on non-string merges (`session-store.ts:586-605`)

```ts
if (typeof current !== "object" || !(field in current)) return;
const value = current[field as keyof Part];
if (typeof value !== "string") return;
```

When a delta targets a non-string field (e.g., a nested token count) the event
is silently dropped. This is not necessarily wrong, but the SDK can grow
non-string deltas over time; log or surface these as unknowns so future protocol
changes don't disappear silently.

### B5. `LoadedSession.status` uses state from before refresh (`sidebar-provider.ts:419`)

`loadSession` captures the *previous* status snapshot:

```ts
status: this.toSdkStatus(this.store.getSession(sessionID)?.status),
```

If a `session.status` event is delivered during the `Promise.all` the freshly
retrieved `info` payload is committed with a stale status, wiping the more recent
update. The race is narrow but real, because `upsertSession` below does
`if (extras?.status) current.status = extras.status;` — `status` is always
truthy (it is never `undefined`), so the stale status *always* overrides. Fix:
only pass `status` when `getSession` had one recorded *before* the request
started, or drop the status from `extras` entirely and let event-driven updates
own it.

### B6. `context.preview` host message duplicates chips on mirror mismatch (`app.tsx:339-342`)

```ts
case "context.preview":
  updateContextChips([...state.contextChips, message.payload]);
```

Host also keeps its own `this.contextChips` (`sidebar-provider.ts:210-222`).
After `context.sync` the host mirror and webview list can disagree silently
because the host never actually *uses* `contextChips` to send prompts (the
webview sends its own `chips()` with `prompt.send`). The host field is only used
in `viewState()` during HTML re-render (fallback path). So the whole
`contextChips` field on the host is effectively dead state except for the
fallback reload. Either make the host authoritative (then the server-rendered
fallback is consistent) or remove the host field and drop `context.sync`
entirely. Current half-and-half design is fragile.

### B7. `resolveCliPath` path-expansion edge case (`process-manager.ts:193-208`)

- `trimmed === "~"` resolves to `homedir()`, which is a directory, not a
  binary. `fs.existsSync` passes, but `spawn` then fails with EACCES/EISDIR.
  Reject this explicitly.
- `trimmed.startsWith(`~${path.sep}`)` won't match `~/...` on Windows when
  `path.sep === "\\"`. Accept both separators.

### B8. `PermissionCard` never exposes the "always" remember option (`permission-card.tsx`)

`Client.replyPermission` supports `remember`, but the UI only has `Approve` and
`Deny`. Users must re-approve every time. Either expose a "Always allow"
control or drop the `remember` argument from the protocol for honesty.

### B9. `scheduleHtmlRefresh` can refresh the HTML shell mid-session (`sidebar-provider.ts:671-683`)

The fallback rewrites `webview.html` after 250ms if no `host.ack` arrives. This
works but:

- It fires after **every** post that precedes the first `host.ack`, re-running
  the full mount, re-bootstrapping, and discarding the webview's Solid store
  (except what survives `vscode.getState()`).
- It currently guards via `!this.hostAcked`, but the timer is not cleared if an
  ack arrives between `scheduleHtmlRefresh` and the 250ms tick — the guard
  handles it, so correct, but a little brittle.
- The timer is not cleared on webview dispose; after dispose `this.view` is
  undefined and the callback early-returns, so it's safe but leaks a reference
  for up to 250ms.

### B10. Unbounded `DiffDocumentProvider` / `RawMessageDocumentProvider` maps

`Map<string, string>` entries are never evicted. Over long sessions this is a
slow memory leak. Add a cap (LRU around ~50 entries) or clear on session archive.

### B11. `Session.info.updatedAt` can be non-numeric (`sidebar-provider.ts:253-257` / `sidebar-header.tsx:44-46`)

`sidebar-header` defensively falls back to `Date.now()` if `updatedAt` is not
a number, but `SessionStore.snapshot` sorts by `b.info.updatedAt - a.info.updatedAt`
with no guard, which will NaN-sort and produce an unstable order. Normalize in
`toSessionSummary`.

### B12. `handle` does not update `hostAcked` reset on webview re-bind (`sidebar-provider.ts:82-90`)

`resolveWebviewView` resets `hostAcked = false`, but the HTML-refresh fallback
timer can still be armed. When the view is re-rendered via that fallback and
the webview posts a fresh `host.ack`, everything recovers, but the first few
posts after resolve may arm another `htmlRefreshTimer`. Clear the timer in
`resolveWebviewView`.

### B13. Message id ordering assumed lexicographic (`session-store.ts:49-50`, `:663-664`)

`sortById` uses `localeCompare`; revert gating uses `m.id < revertMsgId`.
These work only if OpenCode message IDs are monotonically ordered lexically
(ULID or similar). Document the invariant in a code comment, since any
accidental use of UUIDv4 would silently break ordering.

### B14. `archive` flow: revert-gated messages still loaded in `snapshot`

`serialize` filters messages after `revertMsgId`, but the underlying SDK call
`revertTurn` only records the revert pointer; the filtered data is still kept in
`session.messages` and will grow across reverts. Trim on a revert event or at
least when `session.updated` arrives.

### B15. No abort-controller for server-side SDK calls on view dispose

`loadSession` issues 6 simultaneous SDK calls; if the webview disposes or the
user switches sessions rapidly, the requests still complete and commit state
that is no longer active. Thread an `AbortSignal` through.

---

## 3. Security / vulnerability observations

### S1. CSP inline bootstrap is OK but payload escaping is minimal (`html.ts:27`)

```ts
const payload = JSON.stringify(state).replace(/</g, "\u003c");
```

This prevents `</script>` breakout but does not escape `\u2028` / `\u2029`
(valid JSON, invalid JS line terminators) nor `<!--`. In practice this is
benign because every data source is local and trusted, but the safer idiom is:

```ts
JSON.stringify(state)
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");
```

### S2. CSP `img-src` allows `https:` for unused images (`html.ts:34`)

`DOMPurify` is configured with `FORBID_TAGS: ["img"]` and
`ALLOWED_URI_REGEXP: /^$/`, so no images should ever render. The CSP nonetheless
allows `img-src https:`. Tighten to `img-src 'none'` (or remove `https:`) to
close the residual channel.

### S3. Unified diff reconstruction can reveal content that was never shown

When a patch is previewed, `applyUnifiedDiff` materializes data from the patch
alone. This is data the user already requested, so not a leak, but combined with
B10 (unbounded retention) means diff virtual docs linger indefinitely. Clean
them up on session archive.

### S4. `replyQuestion` / `replyPermission` have no authorization check

The webview can forward arbitrary `requestID`s, and the host blindly forwards
them to the SDK. Since the webview is co-located and not remote-accessible this
is acceptable, but validate that the `requestID` belongs to the active session
before forwarding — useful as defense-in-depth against confused-deputy bugs in
the SDK.

### S5. `fs.realpathSync` on untrusted user input (`sidebar-provider.ts:566, 578`)

The path is normalized, the parent is `realpath`'d, and the resolved child is
checked to remain under the parent. The dual-check pattern is correct. However,
symlinks under the project root that point outside the tree will pass the
relative check because the realpath of a child under a symlink stays under
`root`. If you care about escaping via symlinks, compare `target`'s realpath
against `root`'s realpath rather than `path.relative`.

### S6. `OPENCODE_WORKSPACE_ROOT` environment escape (`sidebar-provider.ts:551-552`)

If the user happens to have this environment variable set globally, the
extension will use it without a workspace being open. Acceptable for a dev
feature, but document it, or gate behind a setting so a stray env var can't
silently change the workspace root.

### S7. Basic auth password lifetime

The password is regenerated on every `start()` but never rotated while running.
For a long-lived dev server this is acceptable. Note: the password is kept in
memory on both the extension and child process; no file is written. Good.

---

## 4. Code quality and best practices

### Q1. Dual `.status-row` CSS class usage in `sidebar-header.tsx:203, 311`

The outer `div.status-row` contains another nested `div.status-row` used only
for the connection dot. Nesting a block under itself is confusing and makes the
CSS harder to scope. Rename inner to `.status-indicator` or similar.

### Q2. Dead / placeholder host-side `contextChips` field

See **B6**. Either use or delete.

### Q3. Repetitive "early-exit if no sdk" pattern across 15 `Client` methods

Consider a small `run<T>(label, fn)` wrapper that captures the "SDK missing"
early exit plus the logging around every call. This also centralizes error
shaping.

### Q4. DTO mapping is repetitive in `session-store.ts`

`toMessageSummary`, `toStatus`, `toDiff`, `toPermission`, `toQuestion`,
`toTodo`, `toPart` are all pure. They could live in a single `dto.ts` module
with one `serialize(session)` entry-point, keeping `SessionStore` focused on
state mutation and event handling. Today `session-store.ts` is 693 lines, ~55%
of which is mapping code.

### Q5. `App.tsx` is 713 lines and handles store, messaging, scroll, drag,
modals, and global error listeners. Split into:

- `useHostChannel` (subscribe/enqueue/receive)
- `usePersistedState`
- `useAutoScroll`
- `useComposerResizer`

Each is small, testable, and the main component reduces to layout only.

### Q6. `reportAsync` uses `setTimeout(..., 0)` wrappers unnecessarily

`log()` already calls `vscode.postMessage`, which is synchronous and safe to
call from within error handlers. The `setTimeout` indirection adds latency for
no benefit. Just call `log(message)` directly.

### Q7. `Dropdown` uses `setTimeout(fn, 10)` to focus first item

Replace with `queueMicrotask` or `requestAnimationFrame`. Magic 10ms timers are
flaky under high load.

### Q8. `JSON.stringify` as `DraftControls` select value (`draft-controls.tsx:269`)

Using stringified JSON as an option value works but requires `JSON.parse` later.
Preferable: keep a `Map<string, DraftModel>` keyed by a synthetic id
(`${providerID}/${modelID}`) and look up on change.

### Q9. `For` with synthetic "empty" session (`sidebar-header.tsx:148-162`)

Casting a placeholder to `SessionState` via `as unknown as SessionState` is a
code smell. Use `<Show when={props.sessions.length === 0} fallback={<For>...}/>`:

```tsx
<Show when={props.sessions.length === 0} fallback={
  <For each={props.sessions}>{(session) => ...}</For>
}>
  <div class="dropdown-item-empty">No sessions yet</div>
</Show>
```

### Q10. No tests or linter

- No ESLint config; `prettier` only formats.
- No test harness. Even a handful of unit tests for `DraftStore`,
  `SessionStore.handleEvent`, `applyUnifiedDiff`, and
  `normalizeFileReference` would catch regressions (several of the bugs above
  would have been caught by a test for `applyUnifiedDiff` with a two-hunk
  patch).

### Q11. `EventEmitter` typing

Both `SessionStore` and `ProcessManager` extend untyped `EventEmitter`. Use
typed event emitters (`strict-event-emitter-types` or a minimal in-house typed
wrapper) so that `store.on("change", ...)` is statically checked.

### Q12. `ProcessManager.stop()` doesn't wait / doesn't SIGKILL on timeout

If the CLI hangs on shutdown, the extension dispose returns immediately. Not
catastrophic, but `proc.kill(); setTimeout(() => proc.kill("SIGKILL"), 2000)`
is safer.

### Q13. Magic numbers

`ERROR_DISMISS_MS`, `AUTO_SCROLL_THRESHOLD_PX` are constants — good. But
`250ms` (html refresh), `50ms` (snapshot debounce), `10ms` (dropdown focus),
`100ms` composer buffer, `13001` default port, `30_000ms` health timeout are
scattered. Centralize in a `constants.ts`.

### Q14. `openRawMessage`'s `languages.setTextDocumentLanguage` round-trip

The doc is opened first, then re-opened as JSON. Simpler: use
`uri.path` ending in `.json` (already done) and VS Code will detect automatically.
Drop the explicit `setTextDocumentLanguage` call.

### Q15. `Client.revertTurn` fetches the message twice

First by guard check (`sdk.session.message({...})`), then `sdk.session.revert`
presumably does its own lookup server-side. Consider dropping the local guard
if the server already validates the message role, or cache a shallow
role-by-id lookup.

### Q16. Prettier config `.prettierrc` is tiny; the repo also has implicit
style rules (import ordering, component file naming). An ESLint config with
Solid + TypeScript rules would lock these down.

---

## 5. Redundant code, config, and docs

### R1. Committed build artifacts

- `dist/` is in the working tree (gitignored, but present locally).
- `opencode-vsc-0.3.0.vsix` and `opencode-vsc-0.3.1.vsix` both exist at repo
  root (gitignored). Old versions accumulate; prune periodically or
  auto-version via CI.

### R2. `docs/legacy/` contains three historical files

- `IMPLEMENTATION_PLAN.md`
- `codebase-review-2026-04-09.md`
- `codebase-review-2026-04-12.md`

Fine to keep as history, but these duplicate a lot of the current docs and can
confuse readers. Move to a single `docs/legacy/README.md` index or a git tag.

### R3. `contributes.categories` includes `"Programming Languages"` and
`"Machine Learning"`

Neither is accurate for a chat extension. Marketplace categorization should be
narrowed to `AI` (or `Chat`) — inappropriate categories slow review.

### R4. `SessionState` carries `.messages[].attachments` duplicated from parts

`serialize()` builds `attachments` by filtering the same parts it just mapped
(`session-store.ts:675-679`). Compute once.

### R5. `main.css` is only `@import`s; Vite can inline that via the entry CSS.
If retained, nice. If you switch to CSS-in-JS or CSS modules later, this index
becomes stale.

### R6. `src/globals.d.ts` declares `declare module "*.css" {}` but
`vite-plugin-solid` + `vite` already handle `import "./main.css"` without type
complaints. It's harmless, but redundant.

### R7. `.vscode/` files (`launch.json`, `settings.json`, `tasks.json`) not
reviewed but commonly drift. Worth auditing once.

### R8. `package.json` has both `watch` (dual) and `watch:extension` /
`watch:webview`. Keep as-is — useful.

### R9. `EventStream.on("statusChange", ...)` in `extension.ts` is not
registered — instead `SidebarProvider` and `EventStream` each subscribe. OK,
but document that `ProcessManager.statusChange` is multicast to several
consumers.

---

## 6. Possible improvements / suggestions

### I1. Telemetry-off dev toggle

`proc.log(...)` is very chatty; every SDK call logs twice. A
`opencode.debug.verbose` setting (default `false`) would quiet the Output
channel for normal users while keeping the detailed trail for debugging.

### I2. Debounce `session.snapshot` snapshot construction, not just posting

Currently snapshot is *posted* on a 50ms debounce but
`SessionStore.snapshot` getter runs every time `view.visible` changes. For a
chat with 1000 parts this matters. Cache the serialized snapshot with a dirty
flag.

### I3. Lazy part serialization

`serialize` maps **every** message's parts even for sessions not currently
active. Gate on `activeSessionId` and serialize summaries only for the others.

### I4. Handle `message.part.delta` for non-string fields

Extend the switch to handle numeric/array deltas explicitly, or at minimum log
them so future SDK upgrades don't silently no-op.

### I5. Accessibility

- `role="presentation"` on modal backdrop is fine, but the inner `confirm-dialog`
  has `role="dialog"` but no focus trap. Pressing Tab leaves the dialog. Add
  focus management (focus first button on open, trap within container).
- `bubble-action` buttons have no `aria-label` when showing only an icon.
- `Dropdown` menu uses `role="menu"` implicitly via `aria-haspopup="menu"` on
  the trigger, but the menu container itself lacks `role="menu"` and items
  lack `role="menuitem"`. Screen readers get a generic list.

### I6. Input validation for `session.switch`

If a stale session ID arrives, `activeSessionId` is set to a non-existent
session and the UI shows an empty state until the next snapshot clears it. Drop
the update if `store.getSession(id)` returns undefined.

### I7. Internationalization readiness

All user-facing strings are hard-coded English. For a public extension, wrap in
`vscode.l10n.t(...)` or collect in a `strings.ts` now to make eventual
translation tractable.

### I8. Remove `viteConfig` duplication

`vite.webview.config.ts` uses `path.resolve(__dirname, ...)` inside an ES
module — works (Vite shims `__dirname`), but `fileURLToPath(import.meta.url)`
is more portable if you ever switch to pure ESM.

### I9. Bundle size of webview

`marked` + `dompurify` + `solid` are bundled in every reload. Consider code
splitting the markdown renderer (it's only used when transcripts have content).
Not critical for a webview but reduces first-paint time noticeably.

### I10. Diff integration with `vscode.scm`

For a richer experience, registering the session diffs with the SCM provider
would show file counts in the activity bar and let users use the standard
"Open Changes" gesture. Bigger lift, but a notable UX upgrade.

### I11. Recovery after server crash

`EventStream` reconnects every 1000ms, but if `ProcessManager` enters `error`
state it never auto-restarts. Add an exponential-backoff auto-restart (with a
max retry count) instead of forcing the user to reload the window.

### I12. Token cost / context limit may be stale

`details.contextLimit` is resolved from the current draft model, not the model
used for the **latest assistant response**. If the user switched models, the
displayed % is based on the new model's limit against the old model's usage —
misleading. Use `latestUserModel`'s limit for the % badge.

### I13. Prefer `structuredClone` over hand-rolled `cloneChips` / `cloneDraft`

Modern Node and all supported webview runtimes include it. Simpler and
future-proof against new fields.

### I14. Hostname flexibility

`findPort` binds `127.0.0.1`, process spawn uses `--hostname 127.0.0.1`. If
`opencode.server.url` ever used a non-loopback host, this is silently ignored.
Either parse the host from the URL or document it as loopback-only.

### I15. Rename `WebviewContext` confusion

`src/extension/vscode/workspace-context.ts` is about *workspace* context chips,
not webview context. Name is fine; just noting.

---

## 7. File-by-file notes

| File | LoC | Notes |
|---|---|---|
| `src/extension/extension.ts` | 97 | Clean. Could await the IIFE via `context.subscriptions.push` style for clarity. |
| `src/extension/opencode/process-manager.ts` | 227 | Solid. See B7, Q12, I14. |
| `src/extension/opencode/client.ts` | 318 | Repetitive (Q3). `sourceText()` always returns `{ value: "", start: 0, end: 0 }` — inline. |
| `src/extension/opencode/event-stream.ts` | 84 | Good. Consider exponential backoff (I11). |
| `src/extension/opencode/session-store.ts` | 693 | See Q4, B4, B13, B14, I2, I3. Split DTO module. |
| `src/extension/vscode/diff-document-provider.ts` | 29 | See B10. |
| `src/extension/vscode/raw-message-document-provider.ts` | 29 | See B10. |
| `src/extension/vscode/workspace-context.ts` | 56 | Good; `selectionRange` duplicates logic in `toContextChip` (`session-store.ts:263-272`). Extract shared `rangeFromVsCodeRange`. |
| `src/extension/webview/draft-store.ts` | 173 | Good; `parseModel` uses `value.split("/")` but model IDs can include `/`. Use `indexOf("/")` + `slice`. |
| `src/extension/webview/html.ts` | 49 | See S1, S2. |
| `src/extension/webview/sidebar-provider.ts` | 742 | Very long. See B1, B2, B5, B9, B12, B15, Q2, Q14. |
| `src/shared/models.ts` | 246 | `AgentOption.mode` enum includes `"all"` (likely should be `"all"`) — verify against SDK enum. |
| `src/shared/protocol.ts` | 76 | Tight. Consider branding `SessionID` / `MessageID` as nominal types. |
| `src/webview/app.tsx` | 713 | See Q5, Q6, I6. |
| `src/webview/main.tsx` | 11 | Fine. |
| `src/webview/components/transcript.tsx` | 544 | Heaviest component. `renderMarkdown` is called in every render; memoize per-segment. |
| `src/webview/components/composer.tsx` | 197 | See B3. |
| `src/webview/components/sidebar-header.tsx` | 317 | See Q1, Q9, I12. |
| `src/webview/components/draft-controls.tsx` | 322 | Nicely factored; see Q8. |
| `src/webview/components/dropdown.tsx` | 148 | See Q7. |
| `src/webview/components/question-card.tsx` | 200 | Good. Reset effect relies on `id + count`; if the server mutates options but keeps id/count, stale state persists. |
| `src/webview/components/permission-card.tsx` | 33 | See B8. |
| `src/webview/components/changed-files.tsx` | 45 | `diff.status` is never displayed. Could add A/M/D tag. |
| `src/webview/components/icons.tsx` | 111 | Fine. |
| `src/webview/styles/*.css` | ~1200 | Not reviewed line-by-line. The dual `.status-row` (Q1) should be fixed here too. |
| `esbuild.extension.mjs` | 21 | Fine. Consider `sourcesContent: false` in production to avoid shipping TS in maps. |
| `vite.webview.config.ts` | 29 | Fine. See I8. |
| `tsconfig.json` | 20 | Strict. Consider `"noUncheckedIndexedAccess": true` — would surface several `items[index]` accesses as `T | undefined`. |
| `package.json` | 103 | See R3. No `engines.node`; `@types/node@20` suggests Node 20, but no enforcement. |
| `docs/*` | — | Good current docs. Move `docs/legacy/` as per R2. |
| `AGENTS.md` | 29 | Good. |
| `README.md` | 31 | Short. Consider adding "Known limitations" and "Supported OpenCode versions". |
| `.prettierrc` | — | Minimal. Add `printWidth`, `trailingComma`. |

---

## Prioritized action list

**Must-fix (correctness):**

1. B1 `applyUnifiedDiff` multi-hunk loss
2. B3 IME Enter-to-send
3. B5 stale-status race in `loadSession`
4. B2 Windows absolute path regex
5. B10 unbounded virtual-doc maps

**Should-fix (quality/security):**

6. S1 bootstrap payload escape
7. S2 tighten CSP `img-src`
8. B6 resolve host/webview chip ownership ambiguity
9. Q4/Q5 split `session-store.ts` and `app.tsx` into smaller modules
10. B8 expose permission "always" remember

**Nice-to-have:**

11. I1 debug log verbosity toggle
12. I4 handle non-string deltas
13. I5 accessibility passes for dialogs and menus
14. Q10 add minimal unit tests for state reducers and pure helpers
15. R2 prune/archive `docs/legacy/`

---

*End of report.*
