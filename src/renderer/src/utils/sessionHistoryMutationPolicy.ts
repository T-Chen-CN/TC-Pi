/** Pi history mutation policy. Unsaved first-send retries have no file to truncate. */
export type HistoryMutationKind = "edit" | "delete" | "resend";

export type HistoryMutationPath = { path: "unsupported-backend" } | { path: "unsupported-unpersisted"; reason: Exclude<HistoryMutationKind, "resend"> } | { path: "unpersisted-resend" } | { path: "fork-mutation"; activate: boolean } | { path: "catalog"; live: boolean };

export function resolveHistoryMutationPath(options: { kind: HistoryMutationKind; live: boolean; persisted: boolean; unsupportedBackend?: boolean }): HistoryMutationPath {
	const { kind, live, persisted, unsupportedBackend } = options;
	if (unsupportedBackend) return { path: "unsupported-backend" };
	if (persisted) {
		// 编辑/重发走 fork；删除走 catalog 文件路径
		if (kind !== "delete") {
			return { path: "fork-mutation", activate: !live };
		}
		return { path: "catalog", live };
	}
	if (kind === "resend") {
		return { path: "unpersisted-resend" };
	}
	return { path: "unsupported-unpersisted", reason: kind };
}

/** 仅确定发送失败时解释分支状态；未知投递结果可能已经被 Agent 接受。 */
export function shouldShowResendRollbackHint(delivered: boolean | "unknown"): boolean {
	return delivered === false;
}
