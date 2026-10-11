/** 工作区切换先关闭来源进程；运行中的任务只能在用户确认后终止。 */
export type WorkspaceRuntimeSwitchInput = { fromProjectId?: string; toProjectId: string; terminateBusy: boolean };
export type WorkspaceRuntimeSwitchResult = { status: "ready" } | { status: "confirmation-required"; busyCount: number } | { status: "failed"; error: string };
