/*
 * Starts, monitors, and stops the managed `opencode serve` process for the extension host.
 */
import * as cp from 'child_process';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export type ProcessStatus = 'stopped' | 'starting' | 'running' | 'error';

export class ProcessManager extends EventEmitter {
  private proc: cp.ChildProcess | null = null;
  private state: ProcessStatus = 'stopped';
  private portValue = 0;
  private pwdValue = '';
  private err?: string;
  private out: vscode.OutputChannel;

  constructor() {
    super();
    this.out = vscode.window.createOutputChannel('OpenCode Server');
  }

  get status() {
    return this.state;
  }

  get port() {
    return this.portValue;
  }

  get password() {
    return this.pwdValue;
  }

  get error() {
    return this.err;
  }

  get baseUrl() {
    return this.portValue ? `http://127.0.0.1:${this.portValue}` : undefined;
  }

  get authHeader() {
    if (!this.pwdValue) return undefined;
    return `Basic ${Buffer.from(`opencode:${this.pwdValue}`).toString('base64')}`;
  }

  log(message: string) {
    this.out.appendLine(message);
  }

  /** Resolves the CLI, starts the server, and waits for health before marking it ready. */
  async start() {
    if (this.state === 'starting' || this.state === 'running') return;

    this.setState('starting');
    this.err = undefined;

    try {
      const cfg = vscode.workspace.getConfiguration('opencode');
      const configuredServerUrl = cfg.get<string>('server.url');
      let preferredPort = 13001;

      if (configuredServerUrl) {
        try {
          const url = new URL(configuredServerUrl);
          const port = Number.parseInt(url.port, 10);
          if (Number.isInteger(port) && port > 0 && port <= 65_535) {
            preferredPort = port;
          }
        } catch {
          // Ignore invalid configured URL and keep the default managed-server port.
        }
      }

      this.portValue = await this.findPort(preferredPort);
      const configured = cfg.get<string>('cli.path') || 'opencode';
      const requireAuth = cfg.get<boolean>('server.requireAuth', true);
      const cli = await this.resolveCliPath(configured);
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      this.pwdValue = requireAuth ? randomBytes(24).toString('base64url') : '';

      this.out.appendLine(`Using opencode CLI: ${cli}`);
      this.out.appendLine(`Managed server auth: ${requireAuth ? 'enabled' : 'disabled'}`);
      this.out.appendLine(`Starting opencode serve on port ${this.portValue}...`);

      this.proc = cp.spawn(cli, ['serve', '--hostname', '127.0.0.1', '--port', `${this.portValue}`], {
        cwd,
        env: {
          ...process.env,
          ...(requireAuth ? { OPENCODE_SERVER_PASSWORD: this.pwdValue } : {}),
        },
      });

      this.proc.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          this.fail(
            `OpenCode CLI '${cli}' was not found. Ensure it is available in PATH or set 'OpenCode › Cli: Path' to the full binary path.`,
          );
          return;
        }
        this.fail(`Failed to spawn opencode: ${err.message}`);
      });

      this.proc.stdout?.on('data', (buf) => {
        this.out.append(buf.toString());
      });

      this.proc.stderr?.on('data', (buf) => {
        this.out.append(buf.toString());
      });

      this.proc.on('exit', (code, signal) => {
        this.proc = null;
        if (this.state === 'stopped') return;
        this.fail(`OpenCode server exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (signal ${signal})` : ''}`);
      });

      const ok = await this.waitForHealth();
      if (!ok) throw new Error(this.err ?? 'Server failed to become healthy before timeout');

      this.setState('running');
      this.out.appendLine(`OpenCode server ready on ${this.baseUrl}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.state !== 'error') {
        this.fail(msg);
      }
      throw err;
    }
  }

  /** Stops the managed server and resets connection state. */
  stop() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.err = undefined;
    this.setState('stopped');
  }

  /** Emits a status transition so other host services can react to server lifecycle changes. */
  private setState(next: ProcessStatus) {
    this.out.appendLine(`Process state: ${this.state} -> ${next}`);
    this.state = next;
    this.emit('statusChange', next);
  }

  /** Records a fatal startup/runtime error and tears down the child process. */
  private fail(message: string) {
    this.err = message;
    this.out.appendLine(message);
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.setState('error');
  }

  /** Scans a small port range so the managed server can bind locally without conflicts. */
  private async findPort(start: number) {
    const open = (port: number) =>
      new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
      });

    let port = start;
    while (!(await open(port))) {
      port += 1;
      if (port > start + 100) throw new Error('Could not find an available port');
    }
    return port;
  }

  /** Expands home and validates configured CLI file paths before spawn. */
  private resolveCliPath(input: string) {
    const trimmed = input.trim();
    const expanded = trimmed === '~' ? os.homedir() : trimmed.startsWith(`~${path.sep}`) ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
    const looksLikePath = path.isAbsolute(expanded) || expanded.includes(path.sep);

    if (looksLikePath && !fs.existsSync(expanded)) {
      throw new Error(`OpenCode CLI not found at configured path: ${expanded}`);
    }

    return expanded;
  }

  /** Polls the server health endpoint until startup finishes or times out. */
  private async waitForHealth(timeout = 30_000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.state === 'error') return false;
      try {
        const res = await fetch(`${this.baseUrl}/global/health`, {
          headers: this.authHeader ? { Authorization: this.authHeader } : undefined,
        });
        if (res.ok) return true;
      } catch {
        // ignore until timeout
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }
}
