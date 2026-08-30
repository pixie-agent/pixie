/**
 * postMessage protocol between Pixie's host layer and sandboxed application
 * iframes. Shared by every render host (MarketplacePanel, RightPanel,
 * ApplicationChat) so the message shapes stay in one place.
 *
 * Host → iframe:
 *   - pixie-application-run-result: reply to a run request initiated by the app
 *   - pixie-application-state-update: outputs of a run initiated elsewhere
 *     (e.g. the system chat) that the app should merge into its state
 * iframe → host:
 *   - pixie-application-run: the app asks the host to run one of its actions
 *   - pixie-application-state: the app reports its current state (consumed by
 *     the system chat to give the agent continuity)
 */

export const APPLICATION_RUN_MESSAGE_TYPE = "pixie-application-run";
export const APPLICATION_RUN_RESULT_MESSAGE_TYPE = "pixie-application-run-result";
export const APPLICATION_STATE_MESSAGE_TYPE = "pixie-application-state";
export const APPLICATION_STATE_UPDATE_MESSAGE_TYPE = "pixie-application-state-update";

export interface ApplicationRunMessage {
  type: typeof APPLICATION_RUN_MESSAGE_TYPE;
  requestId: string;
  actionId: string;
  inputs: Record<string, unknown>;
}

export interface ApplicationStateUpdateMessage {
  type: typeof APPLICATION_STATE_UPDATE_MESSAGE_TYPE;
  outputs: Record<string, unknown>;
  actionId: string;
}

export function isApplicationRunMessage(
  value: unknown,
): value is ApplicationRunMessage {
  if (!value || typeof value !== "object") return false;
  const msg = value as Record<string, unknown>;
  return (
    msg.type === APPLICATION_RUN_MESSAGE_TYPE &&
    typeof msg.requestId === "string" &&
    typeof msg.actionId === "string" &&
    !!msg.inputs &&
    typeof msg.inputs === "object" &&
    !Array.isArray(msg.inputs)
  );
}

export function isApplicationStateMessage(
  value: unknown,
): value is { type: typeof APPLICATION_STATE_MESSAGE_TYPE; state: unknown } {
  if (!value || typeof value !== "object") return false;
  const msg = value as Record<string, unknown>;
  return msg.type === APPLICATION_STATE_MESSAGE_TYPE && "state" in msg;
}
