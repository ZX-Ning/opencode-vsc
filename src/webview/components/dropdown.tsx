import { Component, JSX, createSignal, Show } from 'solid-js';

export const Dropdown: Component<{
  trigger: (props: {
    isOpen: boolean;
    toggle: () => void;
    disabled?: boolean;
    'aria-expanded': boolean;
    'aria-haspopup': 'menu';
    ref: (el: HTMLElement) => void;
  }) => JSX.Element;
  menu: (props: { close: () => void }) => JSX.Element;
  disabled?: boolean;
  menuClass?: string;
  containerClass?: string;
}> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  let triggerRef: HTMLElement | undefined;

  const close = () => {
    setIsOpen(false);
    triggerRef?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      close();
    }
  };

  return (
    <div class={props.containerClass || "dropdown-container"} onKeyDown={onKeyDown}>
      {props.trigger({
        isOpen: isOpen(),
        toggle: () => !props.disabled && setIsOpen(!isOpen()),
        disabled: props.disabled,
        'aria-expanded': isOpen(),
        'aria-haspopup': 'menu',
        ref: (el) => { triggerRef = el; }
      })}
      <Show when={isOpen() && !props.disabled}>
        <div class="dropdown-overlay" onClick={close} />
        <div class={`dropdown-menu ${props.menuClass ?? ''}`}>
          {props.menu({ close })}
        </div>
      </Show>
    </div>
  );
};
