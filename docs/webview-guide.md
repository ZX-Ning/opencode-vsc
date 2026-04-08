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

In `src/webview/app.tsx`:

- `acquireVsCodeApi()` is called once
- startup sends `ready`
- the webview listens for host messages through standard webview messaging
- local persisted state is restored with `getState()`

## What To Avoid

### Do not use HTML rewrites as the main live update path

That remounts the app and creates lifecycle issues.

### Do not pass framework proxies or raw rich SDK objects

Webviews need plain serializable payloads.

### Do not perform heavy bootstrap work in the webview itself

The extension host should prepare the minimal state the webview needs to render.

### Do not overload the message handler

The receive path should be small and robust.

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
5. the sidebar remains responsive with multiple sessions in the workspace
