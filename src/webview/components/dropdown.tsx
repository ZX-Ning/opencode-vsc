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
  initialScroll?: 'active' | 'top';
  onOpen?: () => void;
}> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  let triggerRef: HTMLElement | undefined;
  let menuRef: HTMLDivElement | undefined;

  const focusFirstItem = () => {
    const items = menuRef?.querySelectorAll('button:not([disabled]), input:not([disabled])');
    if (items && items.length > 0) {
      (items[0] as HTMLElement).focus();
    }
  };

  const scrollActiveItemIntoView = () => {
    const activeItem = menuRef?.querySelector('.dropdown-item-active');
    const list = menuRef?.querySelector('.dropdown-list');
    if (!(activeItem instanceof HTMLElement) || !(list instanceof HTMLElement)) return;

    const listRect = list.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    const padding = 4;

    if (itemRect.top < listRect.top + padding) {
      list.scrollTop -= listRect.top + padding - itemRect.top;
      return;
    }

    if (itemRect.bottom > listRect.bottom - padding) {
      list.scrollTop += itemRect.bottom - (listRect.bottom - padding);
    }
  };

  const scrollListToTop = () => {
    const list = menuRef?.querySelector('.dropdown-list');
    if (list instanceof HTMLElement) {
      list.scrollTop = 0;
    }
  };

  const open = () => {
    props.onOpen?.();
    setIsOpen(true);
    setTimeout(() => {
      focusFirstItem();
      if (props.initialScroll === 'top') {
        scrollListToTop();
        return;
      }

      scrollActiveItemIntoView();
    }, 10);
  };

  const close = () => {
    setIsOpen(false);
    triggerRef?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isOpen()) {
      if (e.key === 'ArrowDown' && e.target === triggerRef) {
        e.preventDefault();
        open();
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
          if (wasOpen) {
            setIsOpen(false);
            return;
          }
          open();
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
