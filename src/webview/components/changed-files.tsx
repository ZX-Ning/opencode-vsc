import { For, type Component } from 'solid-js';
import type { DiffState } from '../../shared/models';

type Props = {
  diffs: DiffState[];
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string) => void;
};

export const ChangedFiles: Component<Props> = (props) => {
  return (
    <div class="changed-files">
      <div class="section-title">Changed Files</div>
      <For each={props.diffs}>
        {(diff) => (
          <div class="changed-row">
            <button class="link-button changed-name" onClick={() => props.onOpenFile(diff.file)}>
              {diff.file}
            </button>
            <div class="changed-meta">
              <span class="additions">+{diff.additions}</span>
              <span class="deletions">-{diff.deletions}</span>
              <button class="btn btn-secondary btn-small" onClick={() => props.onOpenDiff(diff.file)}>
                Diff
              </button>
            </div>
          </div>
        )}
      </For>
    </div>
  );
};
