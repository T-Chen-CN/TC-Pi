import type { WorkspaceRuntimeSwitchInput, WorkspaceRuntimeSwitchResult } from "../../shared/types/workspaceRuntime";

export interface WorkspaceRuntimeSwitchPort {
	listProject(projectId: string): Array<{ id: string; busy: boolean }>;
	pauseProject(projectId: string): void;
	resumeProject(projectId: string): void;
	stopAgent(agentId: string): Promise<void>;
	logFailure(error: unknown): void;
}

/** 主进程权威检查忙碌状态；关闭过程隔离新 spawn，确认取消时不改任何进程。 */
export async function switchWorkspaceRuntimes(input: WorkspaceRuntimeSwitchInput, port: WorkspaceRuntimeSwitchPort): Promise<WorkspaceRuntimeSwitchResult> {
	const source = input.fromProjectId;
	if (!source || source === input.toProjectId) {
		port.resumeProject(input.toProjectId);
		return { status: "ready" };
	}
	const busyCount = port.listProject(source).filter((agent) => agent.busy).length;
	if (busyCount && !input.terminateBusy) return { status: "confirmation-required", busyCount };
	port.pauseProject(source);
	try {
		// pause 和快照之间没有 await；在途创建用 generation fence 拒绝迟到 spawn。
		for (const agent of port.listProject(source)) await port.stopAgent(agent.id);
		if (port.listProject(source).length) throw new Error("Workspace still has Agent processes");
		port.resumeProject(input.toProjectId);
		return { status: "ready" };
	} catch (error) {
		port.resumeProject(source);
		port.logFailure(error);
		return { status: "failed", error: error instanceof Error ? error.message : String(error) };
	}
}
