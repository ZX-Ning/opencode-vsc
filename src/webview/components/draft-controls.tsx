import { For, createSignal, type Component } from 'solid-js';
import type { AgentOption, DraftSelection, ModelOption } from '../../shared/models';
import { ChevronDown } from './icons';
import { Dropdown } from './dropdown';

type Props = {
  models: ModelOption[];
  agents: AgentOption[];
  selection: DraftSelection;
  onChange: (next: DraftSelection) => void;
};

function variants(models: ModelOption[], selection: DraftSelection) {
  return models.find((item) => item.providerID === selection.model?.providerID && item.id === selection.model?.modelID)?.variants ?? [];
}

function DraftSelect(props: {
  label: string;
  defaultLabel: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const [searchQuery, setSearchQuery] = createSignal('');
  const displayLabel = () => props.options.find(o => o.value === props.value)?.label || props.defaultLabel;

  const filteredOptions = () => {
    if (!props.searchable || !searchQuery().trim()) {
      return props.options;
    }
    const query = searchQuery().toLowerCase();
    return props.options.filter(opt => opt.label.toLowerCase().includes(query));
  };

  return (
    <Dropdown
      containerClass="draft-dropdown-container"
      menuClass={`draft-dropdown-menu ${props.searchable ? 'draft-dropdown-searchable' : ''}`}
      disabled={props.disabled}
      trigger={(triggerProps) => (
        <button
          class="draft-dropdown-btn"
          disabled={triggerProps.disabled}
          onClick={() => {
            setSearchQuery('');
            triggerProps.toggle();
          }}
          title={props.label}
          aria-expanded={triggerProps['aria-expanded']}
          aria-haspopup={triggerProps['aria-haspopup']}
          ref={triggerProps.ref}
        >
          <span class="draft-dropdown-text">{displayLabel()}</span>
          <ChevronDown size={12} class="draft-dropdown-icon" />
        </button>
      )}
      menu={({ close }) => (
        <div class="dropdown-list">
          {props.searchable && (
            <div class="dropdown-search-container">
              <input
                type="text"
                class="dropdown-search-input"
                placeholder={`Search ${props.label.toLowerCase()}...`}
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <button
            class={`dropdown-item ${props.value === '' ? 'dropdown-item-active' : ''}`}
            onClick={() => {
              props.onChange('');
              close();
            }}
          >
            {props.defaultLabel}
          </button>
          <For each={filteredOptions()}>
            {(opt) => (
              <button
                class={`dropdown-item ${props.value === opt.value ? 'dropdown-item-active' : ''}`}
                onClick={() => {
                  props.onChange(opt.value);
                  close();
                }}
              >
                {opt.label}
              </button>
            )}
          </For>
          {props.searchable && filteredOptions().length === 0 && (
            <div class="dropdown-item-empty">No results found</div>
          )}
        </div>
      )}
    />
  );
}

export const DraftControls: Component<Props> = (props) => {
  const models = () =>
    props.models.map((model) => ({
      label: `${model.providerName} / ${model.name}`,
      value: JSON.stringify({ providerID: model.providerID, modelID: model.id }),
    }));

  return (
    <div class="draft-controls-inline">
      <DraftSelect
        label="Agent"
        defaultLabel="Agent"
        value={props.selection.agent ?? ''}
        options={props.agents.map(a => ({ label: a.name, value: a.name }))}
        onChange={(v) => props.onChange({ ...props.selection, agent: v || undefined })}
      />

      <DraftSelect
        label="Model"
        defaultLabel="Model"
        value={props.selection.model ? JSON.stringify({ providerID: props.selection.model.providerID, modelID: props.selection.model.modelID }) : ''}
        options={models()}
        searchable={true}
        onChange={(value) => {
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
      />

      <DraftSelect
        label="Variant"
        defaultLabel="Default"
        value={props.selection.variant ?? ''}
        disabled={variants(props.models, props.selection).length === 0}
        options={variants(props.models, props.selection).map(v => ({ label: v, value: v }))}
        onChange={(v) => props.onChange({ ...props.selection, variant: v || undefined })}
      />
    </div>
  );
};
