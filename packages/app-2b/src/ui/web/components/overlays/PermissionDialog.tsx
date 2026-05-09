import type { PermissionRequest } from "../../types.ts";
import { truncateArgs } from "../../types.ts";

export function PermissionDialog({
  request,
  onRespond,
}: {
  request: PermissionRequest;
  onRespond: (r: "yes" | "always" | "no") => void;
}) {
  const argsStr = JSON.stringify(truncateArgs(request.args), null, 2);

  return (
    <div className="permission-overlay">
      <div className="permission-dialog">
        <div className="permission-title">Permission Request</div>
        <div className="permission-field">
          <span className="permission-field-label">Agent: </span>
          <span className="permission-field-value">{request.agentName}</span>
        </div>
        <div className="permission-field">
          <span className="permission-field-label">Tool: </span>
          <span className="permission-field-value">{request.toolName}</span>
        </div>
        <div className="permission-field">
          <span className="permission-field-label">Args:</span>
          <pre className="permission-args">{argsStr}</pre>
        </div>
        <div className="permission-buttons">
          <button
            className="perm-btn perm-btn--yes"
            onClick={() => onRespond("yes")}
          >
            Yes once
          </button>
          <button
            className="perm-btn perm-btn--always"
            onClick={() => onRespond("always")}
          >
            Always (session)
          </button>
          <button
            className="perm-btn perm-btn--no"
            onClick={() => onRespond("no")}
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}
