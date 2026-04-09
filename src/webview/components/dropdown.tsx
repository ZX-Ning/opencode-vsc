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
  let menuRef: HTMLDivElement | undefined;

  const close = () => {
    setIsOpen(false);
    triggerRef?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isOpen()) {
      if (e.key === 'ArrowDown' && e.target === triggerRef) {
        e.preventDefault();
        setIsOpen(true);
        setTimeout(() => {
          const items = menuRef?.querySelectorAll('button:not([disabled]), input:not([disabled])');
          if (items && items.length > 0) {
             (items[0] as HTMLElement).focus();
          }
        }, 10);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = Array.from(menuRef?.querySelectorAll('button:not([disabled]), input:not([disabled])') || []) as HTMLElement[];
      const active = document.activeElement as HTMLElement;
      const index = items.indexOf(active);

      let nextIndex = index;
      if (e.key === 'ArrowDown') {
        nextIndex = index < items.length - 1 ? index + 1 : 0;
      } else {
        nextIndex = index > 0 ? index - 1 : items.length - 1;
      }

      if (items[nextIndex]) {
        items[nextIndex].focus();
      }
    }
  };

  return (
    <div class={props.containerClass || "dropdown-container"} onKeyDown={onKeyDown}>
      {props.trigger({
        isOpen: isOpen(),
        toggle: () => {
          if (props.disabled) return;
          const wasOpen = isOpen();
          setIsOpen(!wasOpen);
          if (!wasOpen) {
            setTimeout(() => {
              const items = menuRef?.querySelectorAll('button:not([disabled]), input:not([disabled])');
              if (items && items.length > 0) {
                 (items[0] as HTMLElement).focus();
              }
            }, 10);
          }
        },
        disabled: props.disabled,
        'aria-expanded': isOpen(),
        'aria-haspopup': 'menu',
        ref: (el) => { triggerRef = el; }
      })}
      <Show when={isOpen() && !props.disabled}>
        <div class="dropdown-overlay" onClick={close} />
        <div class={`dropdown-menu ${props.menuClass ?? ''}`} ref={(el) => { menuRef = el; }}>
          {props.menu({ close })}
        </div>
      </Show>
    </div>
  );
};
