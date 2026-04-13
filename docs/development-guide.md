# Development Guide

## Prerequisites

- Node and npm
- VS Code extension development setup
- `opencode` CLI available, or configured through `opencode.cli.path`

## Main Commands

- `npm run compile`
  TypeScript check
- `npm run build`
  Build extension host and webview
- `npm run watch`
  Watch extension and webview builds

## Debugging In VS Code

Use the workspace debug config and run the extension host with `F5`.

Expected debug flow:

1. build runs automatically
2. extension host window opens
3. OpenCode sidebar appears in the activity bar
4. Output channel shows server and sidebar logs

## Important Output Signals

Healthy startup usually looks like:

1. `Extension activate`
2. `Process state: stopped -> starting`
3. `Sidebar resolveWebviewView`
4. `Sidebar received message: ready`
5. `Sidebar bootstrap start`
6. `Sidebar post message: bootstrap`

## Recommended Verification After Changes

For message, state, or UI changes verify all of these:

1. Sidebar opens without blank state.
2. Connection state transitions to connected.
3. Existing sessions appear.
4. New session creation works.
5. Session switching works.
6. Prompt send works.
7. Streaming output does not freeze the sidebar.
8. Attach active file and attach selection work.
9. Model, variant, and agent controls still behave correctly.
10. Archive, compact, revert, and open-diff flows still work.
11. Removed context chips do not reappear after reloading or reopening the sidebar.

## Workspace Root Rules

The extension should target:

1. the current workspace folder
2. active editor workspace folder
3. `OPENCODE_WORKSPACE_ROOT` if explicitly set

It should not silently fall back to the extension repository.

## State And Performance Rules

1. Keep bootstrap small.
2. Hydrate session details lazily.
3. Coalesce frequent updates.
4. Avoid adding unnecessary host/webview chatter.

## When Adding Features

Recommended order:

1. update shared DTOs and protocol if needed
2. update host state and SDK integration
3. update webview rendering
4. verify compile and build
5. manually exercise the sidebar in the debug host

## Troubleshooting Checklist

If the sidebar looks broken:

1. confirm the intended workspace root is selected
2. confirm `ready` is received by the host
3. confirm `bootstrap` is posted
4. confirm the webview acknowledges host messages if that path is in use
5. confirm bootstrap is not loading too much state
6. confirm snapshots are not being posted on every tiny streaming delta
