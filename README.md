# Opencode VSC (WIP)

A sidebar-first AI coding assistant powered by OpenCode.

## Note: 
This Project is heavily vibe-coded, and it's still WIP. 

Main model used: GPT-5.4, Gemini-3.1-pro. Agent: OpenCode.

## Screenshots
<img height="800" src="https://github.com/user-attachments/assets/91aa04e4-78ab-497d-9316-f6317edb1c39" />

_Dark Theme_
<br/>

<img height="800" src="https://github.com/user-attachments/assets/f9e4a06d-ec93-45a8-abe7-7814c2d34b2a" />

_Light Theme_


## Features

- Interactive chat interface inside VS Code.
- "Revert to here" functionality to easily backtrack your context.
- Support for inline code changes, diff visualization, and contextual code discussions.
- Seamlessly connects to your OpenCode backend server.

## Installation

Run `npm install` and then use `npm run compile` and `npm run build` to build the extension. Press `F5` in VS Code to run the extension in the Extension Development Host.

## Requirements

You must have an OpenCode server running. By default, the extension points to `http://localhost:3000`, which can be configured in your settings.

## Development

Check out AGENTS.md and the `docs/` folder for architecture details and postmortems.
