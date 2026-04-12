import { For, createSignal, type Component } from 'solid-js';
import type { DiffState } from '../../shared/models';
import { ChevronDown } from './icons';

type Props = {
  diffs: DiffState[];
  onOpenDiff: (path: string) => void;
};

export const ChangedFiles: Component<Props> = (props) => {
  const [isExpanded, setIsExpanded] = createSignal(false);

  return (
    <div class="changed-files">
      <button 
        class="section-title collapsible-header" 
        onClick={() => setIsExpanded(!isExpanded())}
      >
        <span class="collapsible-title">Changed Files ({props.diffs.length})</span>
        <ChevronDown 
          size={16} 
          class={`collapsible-icon ${isExpanded() ? 'expanded' : ''}`} 
        />
      </button>
      
      {isExpanded() && (
        <div class="changed-files-list">
          <For each={props.diffs}>
            {(diff) => (
              <div class="changed-row">
                <button class="link-button changed-name" onClick={() => props.onOpenDiff(diff.file)}>
                  {diff.file}
                </button>
                <div class="changed-meta">
                  <span class="additions">+{diff.additions}</span>
                  <span class="deletions">-{diff.deletions}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      )}
    </div>
  );
};
