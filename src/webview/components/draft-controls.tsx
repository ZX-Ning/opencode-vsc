import { For, type Component } from 'solid-js';
import type { AgentOption, DraftSelection, ModelOption } from '../../shared/models';

type Props = {
  models: ModelOption[];
  agents: AgentOption[];
  selection: DraftSelection;
  onChange: (next: DraftSelection) => void;
};

function variants(models: ModelOption[], selection: DraftSelection) {
  return models.find((item) => item.providerID === selection.model?.providerID && item.id === selection.model?.modelID)?.variants ?? [];
}

export const DraftControls: Component<Props> = (props) => {
  const models = () =>
    props.models.map((model) => ({
      label: `${model.providerName} / ${model.name}`,
      value: JSON.stringify({ providerID: model.providerID, modelID: model.id }),
    }));

  return (
    <div class="draft-controls">
      <label class="draft-field">
        <span class="draft-label">Agent</span>
        <select
          class="draft-select"
          value={props.selection.agent ?? ''}
          onChange={(event) => props.onChange({ ...props.selection, agent: event.currentTarget.value || undefined })}
        >
          <option value="">Default</option>
          <For each={props.agents}>{(agent) => <option value={agent.name}>{agent.name}</option>}</For>
        </select>
      </label>

      <label class="draft-field">
        <span class="draft-label">Model</span>
        <select
          class="draft-select"
          value={props.selection.model ? JSON.stringify({ providerID: props.selection.model.providerID, modelID: props.selection.model.modelID }) : ''}
          onChange={(event) => {
            const value = event.currentTarget.value;
            let parsedModel = undefined;
            if (value) {
              try {
                parsedModel = JSON.parse(value);
              } catch (e) {
                // Ignore parsing errors
              }
            }
            props.onChange({
              ...props.selection,
              model: parsedModel,
              variant: undefined,
            });
          }}
        >
          <option value="">Default</option>
          <For each={models()}>{(item) => <option value={item.value}>{item.label}</option>}</For>
        </select>
      </label>

      <label class="draft-field">
        <span class="draft-label">Variant</span>
        <select
          class="draft-select"
          value={props.selection.variant ?? ''}
          disabled={variants(props.models, props.selection).length === 0}
          onChange={(event) => props.onChange({ ...props.selection, variant: event.currentTarget.value || undefined })}
        >
          <option value="">Default</option>
          <For each={variants(props.models, props.selection)}>{(variant) => <option value={variant}>{variant}</option>}</For>
        </select>
      </label>
    </div>
  );
};
