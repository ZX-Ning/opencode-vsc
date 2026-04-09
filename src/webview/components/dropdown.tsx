import { Component, JSX, createSignal, Show } from 'solid-js';

export const Dropdown: Component<{
  trigger: (props: { isOpen: boolean; toggle: () => void; disabled?: boolean }) => JSX.Element;
  menu: (props: { close: () => void }) => JSX.Element;
  disabled?: boolean;
  menuClass?: string;
  containerClass?: string;
}> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);

  return (
    <div class={props.containerClass || "dropdown-container"}>
      {props.trigger({
        isOpen: isOpen(),
        toggle: () => !props.disabled && setIsOpen(!isOpen()),
        disabled: props.disabled,
      })}
      <Show when={isOpen() && !props.disabled}>
        <div class="dropdown-overlay" onClick={() => setIsOpen(false)} />
        <div class={`dropdown-menu ${props.menuClass ?? ''}`}>
          {props.menu({ close: () => setIsOpen(false) })}
        </div>
      </Show>
    </div>
  );
};
