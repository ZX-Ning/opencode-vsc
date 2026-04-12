import {
  createOpencodeClient,
  type Agent,
  type Message,
  type Part,
  type PermissionRequest,
  type Provider,
  type QuestionAnswer,
  type QuestionRequest,
  type Session,
  type SnapshotFileDiff,
} from '@opencode-ai/sdk/v2/client';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ProcessManager } from './process-manager';
import type { ContextChip, DraftSelection } from '../../shared/models';

type MessageRow = {
  info: Message;
  parts: Part[];
};

function absolutePath(directory: string, chip: ContextChip) {
  return path.isAbsolute(chip.path) ? chip.path : path.resolve(directory, chip.path);
}

function sourceText(value = '') {
  return {
    value,
    start: 0,
    end: value.length,
  };
}

function selectionLabel(chip: ContextChip) {
  if (!chip.range) return path.basename(chip.path);
  return `${chip.path}#${chip.range.startLine}${chip.range.endLine !== chip.range.startLine ? `-${chip.range.endLine}` : ''}`;
}

export class Client {
  private sdkValue?: ReturnType<typeof createOpencodeClient>;
  private key?: string;

  constructor(private readonly proc: ProcessManager) {}

  get raw() {
    return this.sdk;
  }

  private get sdk() {
    const next = `${this.proc.baseUrl ?? ''}:${this.proc.password}`;
    if (this.key !== next) {
      this.key = next;
      this.proc.log(`Client reconfigured for ${this.proc.baseUrl ?? 'no-base-url'}`);
      this.sdkValue = this.proc.baseUrl
        ? createOpencodeClient({
            baseUrl: this.proc.baseUrl,
            headers: this.proc.authHeader ? { Authorization: this.proc.authHeader } : undefined,
          })
        : undefined;
    }
    return this.sdkValue;
  }

  async getSessions(directory?: string) {
    const sdk = this.sdk;
    if (!sdk) return [] as Session[];
    this.proc.log(`SDK getSessions directory=${directory ?? '<none>'}`);
    const res = await sdk.session.list({ directory, limit: 50 });
    this.proc.log(`SDK getSessions ok count=${res.data?.length ?? 0}`);
    return res.data ?? [];
  }

  async createSession(directory: string) {
    const sdk = this.sdk;
    if (!sdk) return;
    this.proc.log(`SDK createSession directory=${directory}`);
    const res = await sdk.session.create({ directory });
    this.proc.log(`SDK createSession ok id=${res.data?.id ?? '<none>'}`);
    return res.data;
  }

  async getSession(sessionID: string, directory?: string) {
    const sdk = this.sdk;
    if (!sdk) return;
    this.proc.log(`SDK getSession session=${sessionID} directory=${directory ?? '<none>'}`);
    const res = await sdk.session.get({ sessionID, directory });
    this.proc.log(`SDK getSession ok session=${sessionID} found=${!!res.data}`);
    return res.data;
  }

  async archiveSession(sessionID: string, directory?: string) {
    const sdk = this.sdk;
    if (!sdk) return;
    this.proc.log(`SDK archiveSession session=${sessionID} directory=${directory ?? '<none>'}`);
    return sdk.session.update({
      sessionID,
      directory,
      time: { archived: Date.now() },
    });
  }

  async getMessages(sessionID: string, directory?: string) {
    const sdk = this.sdk;
    if (!sdk) return [] as MessageRow[];
    this.proc.log(`SDK getMessages session=${sessionID} directory=${directory ?? '<none>'}`);
    const res = await sdk.session.messages({ sessionID, directory, limit: 100 });
    this.proc.log(`SDK getMessages ok session=${sessionID} count=${res.data?.length ?? 0}`);
    return res.data ?? [];
  }

  async getDiff(sessionID: string, directory?: string, messageID?: string) {
    const sdk = this.sdk;
    if (!sdk) return [] as SnapshotFileDiff[];
    this.proc.log(`SDK getDiff session=${sessionID} directory=${directory ?? '<none>'} message=${messageID ?? '<none>'}`);
    const res = await sdk.session.diff({ sessionID, directory, messageID });
    this.proc.log(`SDK getDiff ok session=${sessionID} count=${res.data?.length ?? 0}`);
    return res.data ?? [];
  }

  async getPendingPermissions(directory?: string) {
    const sdk = this.sdk;
    if (!sdk) return [] as PermissionRequest[];
    this.proc.log(`SDK getPendingPermissions directory=${directory ?? '<none>'}`);
    const res = await sdk.permission.list({ directory });
    this.proc.log(`SDK getPendingPermissions ok count=${res.data?.length ?? 0}`);
    return res.data ?? [];
  }

  async getPendingQuestions(directory?: string) {
    const sdk = this.sdk;
    if (!sdk) return [] as QuestionRequest[];
    this.proc.log(`SDK getPendingQuestions directory=${directory ?? '<none>'}`);
    const res = await sdk.question.list({ directory });
    this.proc.log(`SDK getPendingQuestions ok count=${res.data?.length ?? 0}`);
    return res.data ?? [];
  }

  async getProviders(directory?: string) {
    const sdk = this.sdk;
    if (!sdk) return { providers: [] as Provider[], defaults: {} as Record<string, string> };
    this.proc.log(`SDK getProviders directory=${directory ?? '<none>'}`);
    const res = await sdk.config.providers({ directory });
    this.proc.log(`SDK getProviders ok count=${res.data?.providers.length ?? 0}`);
    return {
      providers: res.data?.providers ?? [],
      defaults: res.data?.default ?? {},
    };
  }

  async getAgents(directory?: string) {
    const sdk = this.sdk;
    if (!sdk) return [] as Agent[];
    this.proc.log(`SDK getAgents directory=${directory ?? '<none>'}`);
    const res = await sdk.app.agents({ directory });
    this.proc.log(`SDK getAgents ok count=${res.data?.length ?? 0}`);
    return res.data ?? [];
  }

  async sendPrompt(
    sessionID: string,
    directory: string,
    text: string,
    attachments: ContextChip[] = [],
    draft?: DraftSelection,
  ) {
    const sdk = this.sdk;
    if (!sdk) return;
    this.proc.log(`SDK sendPrompt session=${sessionID} directory=${directory} attachments=${attachments.length}`);

    // Match OpenCode's own attach-file flow: send file references and let the server-side
    // Read tool expand text files and selected line ranges.
    const parts = [
      { type: 'text' as const, text },
      ...attachments.map((chip) => {
        const filePath = absolutePath(directory, chip);
        const url = pathToFileURL(filePath);

        if (chip.range) {
          url.searchParams.set('start', String(chip.range.startLine));
          url.searchParams.set('end', String(chip.range.endLine));
        }

        return {
          type: 'file' as const,
          mime: 'text/plain',
          filename: chip.range ? selectionLabel(chip) : path.basename(filePath),
          url: url.href,
          source: {
            type: 'file' as const,
            path: chip.path,
            text: sourceText(),
          },
        };
      }),
    ];

    try {
      const res = await sdk.session.promptAsync({
        sessionID,
        directory,
        model: draft?.model,
        agent: draft?.agent,
        variant: draft?.variant,
        parts,
      });
      this.proc.log(`SDK sendPrompt ok session=${sessionID}`);
      return res;
    } catch (err) {
      this.proc.log(`SDK sendPrompt error: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async abortRun(sessionID: string, directory?: string) {
    const sdk = this.sdk;
    if (!sdk) return;
    this.proc.log(`SDK abortRun session=${sessionID} directory=${directory ?? '<none>'}`);
    return sdk.session.abort({ sessionID, directory });
  }

  async compactSession(sessionID: string, directory: string, model?: DraftSelection['model']) {
    const sdk = this.sdk;
    if (!sdk) return;
    this.proc.log(`SDK compactSession session=${sessionID} directory=${directory}`);

    if (!model) {
      throw new Error('No model selected for compacting context');
    }

    return sdk.session.summarize({
      sessionID,
      directory,
      providerID: model.providerID,
      modelID: model.modelID,
    });
  }

  async revertTurn(sessionID: string, directory: string, messageID: string) {
    const sdk = this.sdk;
    if (!sdk) return;
    this.proc.log(`SDK revertTurn session=${sessionID} directory=${directory} message=${messageID}`);

    const msg = await sdk.session.message({ sessionID, messageID, directory });
    if (!msg.data?.info || msg.data.info.role !== 'user') return;

    await sdk.session.revert({ sessionID, directory, messageID });
  }

  async replyPermission(requestID: string, remember?: boolean) {
    const sdk = this.sdk;
    if (!sdk) return;
    this.proc.log(`SDK replyPermission request=${requestID} remember=${!!remember}`);
    return sdk.permission.reply({ requestID, reply: remember ? 'always' : 'once' });
  }

  async rejectPermission(requestID: string) {
    const sdk = this.sdk;
    if (!sdk) return;
    this.proc.log(`SDK rejectPermission request=${requestID}`);
    return sdk.permission.reply({ requestID, reply: 'reject' });
  }

  async replyQuestion(requestID: string, answers: QuestionAnswer[]) {
    const sdk = this.sdk;
    if (!sdk) return;
    this.proc.log(`SDK replyQuestion request=${requestID} answers=${answers.length}`);
    return sdk.question.reply({ requestID, answers });
  }
}
