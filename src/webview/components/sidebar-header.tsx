import { Component } from 'solid-js';

interface SidebarHeaderProps {
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  onNewSession: () => void;
}

export const SidebarHeader: Component<SidebarHeaderProps> = (props) => {
  return (
    <div class="sidebar-header">
      <div class="status-row">
        <div class={`status-dot status-${props.connectionStatus}`}></div>
        <span class="status-label">{props.connectionStatus}</span>
      </div>
      <button class="btn btn-primary btn-small" onClick={props.onNewSession}>
        New Chat
      </button>
    </div>
  );
};
