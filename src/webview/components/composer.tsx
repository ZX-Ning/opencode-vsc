import { Component, createSignal, For, Show } from 'solid-js';
import type { ContextChip } from '../../shared/models';
import { Paperclip, Send } from 'lucide-solid';

interface ComposerProps {
	onSend: (text: string) => void;
	contextChips: ContextChip[];
	onRemoveChip: (index: number) => void;
	onAttachFile: () => void;
	onAttachSelection: () => void;
}

export const Composer: Component<ComposerProps> = (props) => {
	const [text, setText] = createSignal('');
	const [attachOpen, setAttachOpen] = createSignal(false);

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
			<div class="composer-inner">
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
				<div class="composer-toolbar">
					<div class="attach-container">
						<button 
							class="btn btn-icon btn-secondary" 
							onClick={() => setAttachOpen(!attachOpen())}
							title="Attach Context"
						>
							<Paperclip size={16} />
						</button>
						<Show when={attachOpen()}>
							<div class="dropdown-overlay" onClick={() => setAttachOpen(false)} />
							<div class="dropdown-menu attach-dropdown">
								<button 
									class="dropdown-item" 
									onClick={() => {
										setAttachOpen(false);
										props.onAttachFile();
									}}
								>
									Active File
								</button>
								<button 
									class="dropdown-item" 
									onClick={() => {
										setAttachOpen(false);
										props.onAttachSelection();
									}}
								>
									Selection
								</button>
							</div>
						</Show>
					</div>
					<button class="btn btn-icon btn-primary push-right" onClick={handleSend} disabled={!text().trim()} title="Send">
						<Send size={16} />
					</button>
				</div>
      </div>
    </div>
	);
};
