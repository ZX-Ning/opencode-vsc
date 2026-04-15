/*
 * Tracks draft model, variant, and agent selection independently from session transcript state.
 */
import type { Agent, Provider } from "@opencode-ai/sdk/v2/client";
import type { SessionState } from "../../shared/models";
import type {
  AgentOption,
  DraftModel,
  DraftOptions,
  DraftSelection,
  ModelOption,
} from "../../shared/models";

/** Parses `provider/model` strings from config defaults into structured draft values. */
function parseModel(value?: string) {
  if (!value) return undefined;
  const [providerID, modelID] = value.split("/");
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID } satisfies DraftModel;
}

/** Keeps only models that still exist in the current provider catalog. */
function pickModel(providers: Provider[], value?: DraftModel) {
  if (!value) return undefined;
  const provider = providers.find((item) => item.id === value.providerID);
  if (!provider) return undefined;
  const model = provider.models[value.modelID];
  if (!model) return undefined;
  return { providerID: provider.id, modelID: model.id } satisfies DraftModel;
}

/** Uses the most recent user turn as the authoritative draft source for a session. */
function latestUser(session?: SessionState) {
  if (!session) return undefined;
  return [...session.messages]
    .map((item) => item.info)
    .filter((item) => item.role === "user")
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

export class DraftStore {
  private providers: Provider[] = [];
  private defaults: Record<string, string> = {};
  private agents: Agent[] = [];
  private defaultAgent?: string;
  private selection: DraftSelection = {};

  /** Exposes the catalog and normalized selection in the exact shape expected by the webview. */
  get snapshot(): DraftOptions {
    return {
      models: this.providers.flatMap((provider) =>
        Object.values(provider.models).map(
          (model) =>
            ({
              id: model.id,
              name: model.name,
              providerID: provider.id,
              providerName: provider.name,
              variants: model.variants ? Object.keys(model.variants) : [],
              contextLimit: model.limit.context,
            }) satisfies ModelOption,
        ),
      ),
      providerDefaults: this.defaults,
      agents: this.agents.map(
        (agent) =>
          ({
            name: agent.name,
            description: agent.description,
            mode: agent.mode,
            hidden: agent.hidden,
            model: agent.model,
            variant: agent.variant,
          }) satisfies AgentOption,
      ),
      selection: this.selection,
    };
  }

  /** Replaces the available provider and agent catalog, then revalidates the current selection. */
  setCatalog(input: {
    providers: Provider[];
    defaults: Record<string, string>;
    agents: Agent[];
    defaultAgent?: string;
  }) {
    this.providers = input.providers;
    this.defaults = input.defaults;
    this.agents = input.agents.filter((item) => item.mode !== "subagent" && !item.hidden);
    this.defaultAgent = input.defaultAgent;
    this.selection = this.normalize(this.selection);
  }

  /** Normalizes external selection updates against the current catalog. */
  setSelection(input: DraftSelection) {
    this.selection = this.normalize(input);
  }

  /** Restores draft selection from the latest user message in the active session. */
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

  /** Applies fallback rules so agent, model, and variant selections always remain valid together. */
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

  /** Picks the requested agent first, then falls back to configured and conventional defaults. */
  private pickAgent(name?: string) {
    if (name) {
      const item = this.agents.find((agent) => agent.name === name);
      if (item) return item;
    }

    if (this.defaultAgent) {
      const item = this.agents.find((agent) => agent.name === this.defaultAgent);
      if (item) return item;
    }

    const build = this.agents.find((agent) => agent.name === "build");
    if (build) return build;

    const plan = this.agents.find((agent) => agent.name === "plan");
    if (plan) return plan;

    return this.agents[0];
  }

  /** Prefers configured provider defaults, then falls back to the first available model. */
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

  /** Returns the supported variant list for the currently selected model. */
  private variants(model?: DraftModel) {
    if (!model) return [] as string[];
    const provider = this.providers.find((item) => item.id === model.providerID);
    const info = provider?.models[model.modelID];
    if (!info?.variants) return [] as string[];
    return Object.keys(info.variants);
  }
}
