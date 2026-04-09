import { Component, createSignal, For, Show } from 'solid-js';
import type { ContextChip } from '../../shared/models';
import { Paperclip, Send, Square } from './icons';
import { Dropdown } from './dropdown';

interface ComposerProps {
	onSend: (text: string) => void;
	contextChips: ContextChip[];
	onRemoveChip: (index: number) => void;
	onAttachFile: () => void;
	onAttachSelection: () => void;
	isBusy?: boolean;
	onInterrupt?: () => void;
	children?: import('solid-js').JSX.Element;
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
					<Dropdown
						containerClass="attach-container"
						menuClass="attach-dropdown"
						trigger={(triggerProps) => (
							<button 
								class="btn btn-icon btn-secondary" 
								onClick={triggerProps.toggle}
								title="Attach Context"
								aria-expanded={triggerProps['aria-expanded']}
								aria-haspopup={triggerProps['aria-haspopup']}
								ref={triggerProps.ref}
							>
								<Paperclip size={16} />
							</button>
						)}
						menu={({ close }) => (
							<>
								<button 
									class="dropdown-item" 
									onClick={() => {
										close();
										props.onAttachFile();
									}}
								>
									Active File
								</button>
								<button 
									class="dropdown-item" 
									onClick={() => {
										close();
										props.onAttachSelection();
									}}
								>
									Selection
								</button>
							</>
						)}
					/>
					{props.children}
					<Show
						when={props.isBusy}
						fallback={
							<button class="btn btn-icon btn-primary push-right" onClick={handleSend} disabled={!text().trim()} title="Send">
								<Send size={16} />
							</button>
						}
					>
						<button class="btn btn-icon btn-primary push-right" onClick={() => props.onInterrupt?.()} title="Interrupt">
							<Square size={16} />
						</button>
					</Show>
				</div>
      </div>
    </div>
	);
};
