import type { Agent, Provider } from '@opencode-ai/sdk/v2/client';
import type { SessionState } from '../../shared/models';
import type { AgentOption, DraftModel, DraftOptions, DraftSelection, ModelOption } from '../../shared/models';

function sameModel(a?: DraftModel, b?: DraftModel) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.providerID === b.providerID && a.modelID === b.modelID;
}

function parseModel(value?: string) {
  if (!value) return undefined;
  const [providerID, modelID] = value.split('/');
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID } satisfies DraftModel;
}

function pickModel(providers: Provider[], value?: DraftModel) {
  if (!value) return undefined;
  const provider = providers.find((item) => item.id === value.providerID);
  if (!provider) return undefined;
  const model = provider.models[value.modelID];
  if (!model) return undefined;
  return { providerID: provider.id, modelID: model.id } satisfies DraftModel;
}

function latestUser(session?: SessionState) {
  if (!session) return undefined;
  return [...session.messages]
    .map((item) => item.info)
    .filter((item) => item.role === 'user')
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

export class DraftStore {
  private providers: Provider[] = [];
  private defaults: Record<string, string> = {};
  private agents: Agent[] = [];
  private defaultAgent?: string;
  private selection: DraftSelection = {};

  get snapshot(): DraftOptions {
    return {
      models: this.providers.flatMap((provider) =>
        Object.values(provider.models).map((model) => ({
          id: model.id,
          name: model.name,
          providerID: provider.id,
          providerName: provider.name,
          variants: model.variants ? Object.keys(model.variants) : [],
          contextLimit: model.limit.context,
        } satisfies ModelOption)),
      ),
      providerDefaults: this.defaults,
      agents: this.agents.map((agent) => ({
        name: agent.name,
        description: agent.description,
        mode: agent.mode,
        hidden: agent.hidden,
        model: agent.model,
        variant: agent.variant,
      } satisfies AgentOption)),
      selection: this.selection,
    };
  }

  setCatalog(input: { providers: Provider[]; defaults: Record<string, string>; agents: Agent[]; defaultAgent?: string }) {
    this.providers = input.providers;
    this.defaults = input.defaults;
    this.agents = input.agents.filter((item) => item.mode !== 'subagent' && !item.hidden);
    this.defaultAgent = input.defaultAgent;
    this.selection = this.normalize(this.selection);
  }

  setSelection(input: DraftSelection) {
    this.selection = this.normalize(input);
  }

  restore(session?: SessionState) {
    const msg = latestUser(session);
    if (!msg) {
      this.selection = this.normalize({});
      return;
    }

    this.selection = this.normalize({
      agent: msg.agent,
      model: msg.model,
      variant: msg.variant,
    });
  }

  private normalize(input: DraftSelection) {
    const agent = this.pickAgent(input.agent);
    const model = pickModel(this.providers, input.model) ?? agent?.model ?? this.defaultModel();
    const variants = this.variants(model);
    const variant = input.variant ?? agent?.variant;

    return {
      agent: agent?.name,
      model,
      variant: variant && variants.includes(variant) ? variant : undefined,
    } satisfies DraftSelection;
  }

  private pickAgent(name?: string) {
    if (name) {
      const item = this.agents.find((agent) => agent.name === name);
      if (item) return item;
    }

    if (this.defaultAgent) {
      const item = this.agents.find((agent) => agent.name === this.defaultAgent);
      if (item) return item;
    }

    const build = this.agents.find((agent) => agent.name === 'build');
    if (build) return build;

    const plan = this.agents.find((agent) => agent.name === 'plan');
    if (plan) return plan;

    return this.agents[0];
  }

  private defaultModel() {
    for (const provider of this.providers) {
      const model = parseModel(`${provider.id}/${this.defaults[provider.id]}`);
      const valid = pickModel(this.providers, model);
      if (valid) return valid;
    }

    for (const provider of this.providers) {
      const first = Object.values(provider.models)[0];
      if (first) return { providerID: provider.id, modelID: first.id } satisfies DraftModel;
    }

    return undefined;
  }

  private variants(model?: DraftModel) {
    if (!model) return [] as string[];
    const provider = this.providers.find((item) => item.id === model.providerID);
    const info = provider?.models[model.modelID];
    if (!info?.variants) return [] as string[];
    return Object.keys(info.variants);
  }

  hasSelection(input: DraftSelection) {
    return (
      input.agent === this.selection.agent &&
      input.variant === this.selection.variant &&
      sameModel(input.model, this.selection.model)
    );
  }
}
