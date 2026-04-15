/*
 * Renders pending permission requests and forwards approve or deny actions.
 */
import type { Component } from "solid-js";
import type { PermissionState } from "../../shared/models";

type Props = {
  permission: PermissionState;
  onApprove: (requestID: string) => void;
  onDeny: (requestID: string) => void;
};

export const PermissionCard: Component<Props> = (props) => {
  return (
    <div class="card">
      <div class="card-title">Permission Required</div>
      <div class="card-body">
        <div>{props.permission.permission}</div>
        <div class="card-meta">
          {props.permission.patterns.join(", ") || "No patterns provided"}
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-primary" onClick={() => props.onApprove(props.permission.id)}>
          Approve
        </button>
        <button class="btn btn-secondary" onClick={() => props.onDeny(props.permission.id)}>
          Deny
        </button>
      </div>
    </div>
  );
};
