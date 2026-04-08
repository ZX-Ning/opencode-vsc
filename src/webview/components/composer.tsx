import { Component, createSignal, For } from 'solid-js';
import type { ContextChip } from '../../shared/models';

interface ComposerProps {
	onSend: (text: string) => void;
	contextChips: ContextChip[];
	onRemoveChip: (index: number) => void;
	onAttachFile: () => void;
	onAttachSelection: () => void;
}

export const Composer: Component<ComposerProps> = (props) => {
	const [text, setText] = createSignal('');

	const handleSend = () => {
		if (text().trim()) {
			props.onSend(text());
			setText('');
		}
	};

	return (
		<div class="composer">
			<div class="chip-list">
				<For each={props.contextChips}>
					{(chip, index) => (
						<div class="chip">
							<span>{chip.type === 'file' ? 'File' : 'Selection'} {chip.path}{chip.range ? `#L${chip.range.startLine}-L${chip.range.endLine}` : ''}</span>
							<button class="link-button" onClick={() => props.onRemoveChip(index())}>×</button>
						</div>
					)}
				</For>
			</div>
			<div>
				<textarea
					class="composer-input"
					value={text()}
					onInput={(e) => setText(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							handleSend();
						}
					}}
					placeholder="Ask OpenCode..."
				/>
				<div class="composer-actions">
					<button class="btn btn-secondary" onClick={props.onAttachFile}>
						Attach File
					</button>
					<button class="btn btn-secondary" onClick={props.onAttachSelection}>
						Attach Selection
					</button>
					<button class="btn btn-primary push-right" onClick={handleSend}>
						Send
					</button>
				</div>
      </div>
    </div>
	);
};
