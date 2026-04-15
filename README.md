# Opencode VSC

An opencode VS Code extension that works.

## Note:

This Project is heavily vibe-coded.

Main model used: GPT-5.4, Gemini-3.1-pro. Agent: OpenCode, OpenAI Codex.

## Screenshots

<img height="800" src="https://github.com/user-attachments/assets/91aa04e4-78ab-497d-9316-f6317edb1c39" />

_Dark Theme_
<br/>

<img height="800" src="https://github.com/user-attachments/assets/f9e4a06d-ec93-45a8-abe7-7814c2d34b2a" />

_Light Theme_

## Features

- Interactive chat interface inside VS Code.
- Session switcher for moving between OpenCode chats in the sidebar.
- Markdown rendering for assistant responses.
- Clickable file links in chat output to open files directly in VS Code.

## Requirements

You must have the OpenCode CLI installed and available on your `PATH`, or configure `OpenCode › Cli: Path` to point to the binary.

On activation, the extension starts a managed local `opencode serve` process automatically. You do not need to start an OpenCode server yourself.

## Development

Check out [AGENTS.md](AGENTS.md) and the [docs/](docs/) folder for architecture details and postmortems.
