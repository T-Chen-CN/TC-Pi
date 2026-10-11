import type { AgentBackend } from "../../../../shared/types";
import { SecurityLevelMenu } from "./SecurityLevelMenu";

/** Legacy histories have no runnable permission controls. */
export function SecurityControl(props: { sessionId: string; backend?: AgentBackend; disabled?: boolean }) {
	if (props.backend && props.backend !== "pi") return null;
	return <SecurityLevelMenu sessionId={props.sessionId} disabled={props.disabled} />;
}
