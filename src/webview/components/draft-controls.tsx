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

type DraftSelectOption = {
  label: string;
  value: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  searchText?: string;
  searchAliases?: string[];
};

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenizeSearchText(value: string) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(/\s+/) : [];
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function matchesSubsequence(query: string, target: string) {
  if (!query) return false;
  let queryIndex = 0;

  for (const character of target) {
    if (character === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === query.length) return true;
    }
  }

  return false;
}

function scoreOption(option: DraftSelectOption, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return -1;

  const primary = normalizeSearchText(option.primaryLabel ?? option.label);
  const targets = [option.searchText ?? option.label, ...(option.searchAliases ?? [])]
    .map(normalizeSearchText)
    .filter(Boolean);
  const tokens = Array.from(new Set(targets.flatMap(tokenizeSearchText)));
  const primaryTokens = tokenizeSearchText(primary);
  const queryTerms = tokenizeSearchText(normalizedQuery);
  const compactQuery = compactSearchText(query);

  let score = -1;

  if (primary === normalizedQuery) score = Math.max(score, 1300);
  if (targets.some((target) => target === normalizedQuery)) score = Math.max(score, 1200);
  if (primary.startsWith(normalizedQuery)) score = Math.max(score, 1100);
  if (targets.some((target) => target.startsWith(normalizedQuery))) score = Math.max(score, 1000);

  const primaryPrefixMatches = queryTerms.every((term) => primaryTokens.some((token) => token.startsWith(term)));
  if (primaryPrefixMatches) score = Math.max(score, 950);

  const tokenPrefixMatches = queryTerms.every((term) => tokens.some((token) => token.startsWith(term)));
  if (tokenPrefixMatches) score = Math.max(score, 900);

  const substringMatches = queryTerms.every((term) => targets.some((target) => target.includes(term)));
  if (substringMatches) score = Math.max(score, 700);

  const subsequenceMatches = targets.some((target) => matchesSubsequence(compactQuery, target.replace(/\s+/g, '')));
  if (subsequenceMatches) score = Math.max(score, 500);

  if (score < 0) return -1;

  for (const term of queryTerms) {
    if (primaryTokens.some((token) => token === term)) {
      score += 60;
    } else if (primaryTokens.some((token) => token.startsWith(term))) {
      score += 40;
    } else if (tokens.some((token) => token === term)) {
      score += 25;
    } else if (tokens.some((token) => token.startsWith(term))) {
      score += 15;
    } else if (targets.some((target) => target.includes(term))) {
      score += 5;
    }
  }

  return score;
}

function DraftOptionLabel(props: { option?: DraftSelectOption; fallback: string }) {
  const primary = () => props.option?.primaryLabel ?? props.option?.label ?? props.fallback;
  const secondary = () => props.option?.secondaryLabel;

  return (
    <span class={`draft-option-label ${secondary() ? 'draft-option-label-rich' : ''}`}>
      <span class="draft-option-label-primary">{primary()}</span>
      {secondary() ? <span class="draft-option-label-secondary">{secondary()}</span> : null}
    </span>
  );
}

function DraftSelect(props: {
  label: string;
  defaultLabel: string;
  value: string;
  options: DraftSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const [searchQuery, setSearchQuery] = createSignal('');
  const selectedOption = () => props.options.find((option) => option.value === props.value);

  const filteredOptions = () => {
    if (!props.searchable || !searchQuery().trim()) {
      return props.options;
    }

    return props.options
      .map((option, index) => ({ option, index, score: scoreOption(option, searchQuery()) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.option);
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
          <span class="draft-dropdown-text">
            <DraftOptionLabel option={selectedOption()} fallback={props.defaultLabel} />
          </span>
          <ChevronDown size={12} class="draft-dropdown-icon" />
        </button>
      )}
      menu={({ close }) => (
        <>
          {props.searchable && (
            <div class="dropdown-search-container">
              <input
                type="text"
                class="dropdown-search-input"
                placeholder={`Search ${props.label.toLowerCase()}...`}
                value={searchQuery()}
                aria-label={`Search ${props.label.toLowerCase()}`}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div class="dropdown-list">
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
                  <DraftOptionLabel option={opt} fallback={opt.label} />
                </button>
              )}
            </For>
            {props.searchable && filteredOptions().length === 0 && (
              <div class="dropdown-item-empty">No results found</div>
            )}
          </div>
        </>
      )}
    />
  );
}

export const DraftControls: Component<Props> = (props) => {
  const models = () =>
    props.models.map((model) => ({
      label: model.name,
      primaryLabel: model.name,
      secondaryLabel: model.providerName,
      searchText: `${model.name} ${model.providerName}`,
      searchAliases: [
        `${model.providerName} ${model.name}`,
        model.id,
        model.providerID,
        `${model.providerID} ${model.id}`,
      ],
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
        defaultLabel="Default"
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
