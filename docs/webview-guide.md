# Webview Guide

## Purpose

This document describes how this repo uses VS Code webviews and what rules contributors should follow.

It is intentionally aligned with the official VS Code webview documentation.

Reference:

- `https://code.visualstudio.com/api/extension-guides/webview`

## Primary Rules

1. Use the standard `postMessage` model first.
2. Initialize each resolved `WebviewView` instance fully.
3. Keep the webview script simple.
4. Use `getState` and `setState` for persisted webview-local state.
5. Keep host-to-webview payloads JSON-safe.

## How This Repo Applies The Docs

### `resolveWebviewView`

In `src/extension/webview/sidebar-provider.ts`:

- the resolved view gets options set
- the HTML document is assigned
- message handling is bound to that specific view
- visibility and disposal are handled explicitly

### HTML shell

In `src/extension/webview/html.ts`:

- the HTML document is complete
- the bundle is loaded via a script tag
- CSP is kept strict enough for a sidebar webview
- only initial serialized state is injected inline

### Webview startup

The webview entry point is `src/webview/main.tsx`, which mounts the Solid app.

In `src/webview/app.tsx`:

- `acquireVsCodeApi()` is called once
- startup sends `ready`
- the webview listens for host messages through standard webview messaging
- local persisted state is restored with `getState()`
- host-mirrored local state such as `contextChips` is synced back to the host after mount

## What To Avoid

### Do not use HTML rewrites as the main live update path

That remounts the app and creates lifecycle issues.

### Do not pass framework proxies or raw rich SDK objects

Webviews need plain serializable payloads.

### Do not perform heavy bootstrap work in the webview itself

The extension host should prepare the minimal state the webview needs to render.

### Do not overload the message handler

The receive path should be small and robust.

### Keep fallback-injected state mirrored when required

This repo still has an HTML refresh fallback for webview compatibility.

If a piece of locally edited state is also injected into the HTML shell, the host mirror must stay aligned so reloads do not restore stale state.

Currently this applies to `contextChips`.

## Current Practical Notes

This repo currently uses a compatibility fallback when host acknowledgements are missing.

That exists because some runs showed host messages being posted successfully while the webview did not appear to process them reliably.

Treat this as a fallback, not the design ideal.

## When Changing Webview Code

Always verify:

1. `ready` still fires
2. `bootstrap` still reaches the UI
3. session switching still works
4. prompt sending still works during streaming output
5. removed context chips do not reappear after sidebar reload or fallback refresh
6. the sidebar remains responsive with multiple sessions in the workspace
7. archive session flow works (session removed from list, next session selected)
8. revert message flow works (confirmation modal, transcript updated)
9. file links in transcript open the correct file in the editor
10. diff viewing opens correct before/after content in VS Code's diff editor
11. raw message viewing opens formatted JSON as a readonly document
12. todo panel shows progress and updates during task runs
13. permission card approve/deny actions complete without errors
14. question card answer flow works (single-select, multi-select, and custom text)
