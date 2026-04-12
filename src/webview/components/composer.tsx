import { Component, For, Show, createSignal } from 'solid-js';
import type { ContextChip, TodoState } from '../../shared/models';
import { ChevronDown, Paperclip, Send, Square } from './icons';
import { Dropdown } from './dropdown';

interface ComposerProps {
	text: string;
	onTextChange: (text: string) => void;
	onSend: (text: string) => void;
	contextChips: ContextChip[];
	todos: TodoState[];
	onRemoveChip: (index: number) => void;
	onAttachFile: () => void;
	onAttachSelection: () => void;
	isBusy?: boolean;
	onInterrupt?: () => void;
	children?: import('solid-js').JSX.Element;
}

function status(value: string) {
	return value.replace(/_/g, ' ');
}

export const Composer: Component<ComposerProps> = (props) => {
	const [expanded, setExpanded] = createSignal(false);

	const handleSend = () => {
		if (props.text.trim()) {
			props.onSend(props.text);
			props.onTextChange('');
		}
	};

	const done = () => props.todos.filter((todo) => todo.status === 'completed').length;
	const active = () => props.todos.find((todo) => todo.status === 'in_progress')
		?? props.todos.find((todo) => todo.status === 'pending');
	const preview = () => {
		const todo = active();
		if (todo) return todo.content;
		if (done() === props.todos.length) return 'All todos completed';
		return 'View todos';
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
			<Show when={props.todos.length > 0}>
				<div class="todo-inline">
					<button
						class="todo-trigger"
						type="button"
						onClick={() => setExpanded(!expanded())}
						title={preview()}
						aria-expanded={expanded()}
						aria-controls="composer-todo-list"
					>
						<span class="todo-trigger-text">TODO: {preview()}</span>
						<ChevronDown size={14} class={`todo-trigger-icon ${expanded() ? 'expanded' : ''}`} />
					</button>
					<Show when={expanded()}>
						<div class="todo-inline-panel" id="composer-todo-list">
							<div class="todo-list">
								<For each={props.todos}>
									{(todo) => (
										<div class="todo-item">
											<span
												class="todo-item-dot"
												classList={{
													'todo-item-dot-pending': todo.status === 'pending',
													'todo-item-dot-in-progress': todo.status === 'in_progress',
													'todo-item-dot-completed': todo.status === 'completed',
													'todo-item-dot-cancelled': todo.status === 'cancelled',
												}}
											/>
											<div class="todo-item-body">
												<div
													class="todo-item-content"
													classList={{
														'todo-item-content-completed': todo.status === 'completed',
														'todo-item-content-cancelled': todo.status === 'cancelled',
													}}
												>
													{todo.content}
												</div>
												<div class="todo-item-meta">
													<span>{status(todo.status)}</span>
													<span class="todo-priority">{todo.priority}</span>
												</div>
											</div>
										</div>
									)}
								</For>
							</div>
						</div>
					</Show>
				</div>
			</Show>
			<div class="composer-inner">
				<textarea
					class="composer-input"
					value={props.text}
					onInput={(e) => props.onTextChange(e.currentTarget.value)}
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
							<button class="btn btn-icon btn-primary push-right" onClick={handleSend} disabled={!props.text.trim()} title="Send">
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
