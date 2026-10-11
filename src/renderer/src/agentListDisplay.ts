import { canonicalizeSessionPath } from "../../shared/sessionIdentity";
import type { SessionEnvironment } from "../../shared/types";

/**
 * 会话/Agent 行的状态点 Tailwind bg 类（跨 Sidebar SessionTree 与会话 Tab 复用）。
 * 用户语义：idle=蓝、starting/运行中=黄、error=红；未启动（无 runtime）不显示点。
 * 该 helper 同时供会话 Tab 与侧栏会话行使用，确保蓝/黄/红状态语义一致。
 */
export function sessionStatusDotClass(status?: string | null): string | undefined {
	// detached 视为未真正运行：不渲染色点，与未启动会话一致
	if (!status || status === "detached") return undefined;
	switch (status) {
		case "error":
			return "bg-danger";
		case "idle":
			return "bg-info";
		// running / starting / pending 均反映“正在工作/等待”，同一黄色点
		case "running":
		case "starting":
		case "pending":
		case "waiting":
			return "bg-warning";
		default:
			return undefined;
	}
}

// native 路径不区分大小写；WSL 路径保留大小写，并使用环境前缀防止跨来源碰撞。
export function normalizeSessionPathForCompare(sessionPath?: string, environment: SessionEnvironment = "native") {
	return sessionPath ? canonicalizeSessionPath(sessionPath, environment) : undefined;
}

export function isSameSessionPath(left?: string, right?: string, environment: SessionEnvironment = "native") {
	const normalizedLeft = normalizeSessionPathForCompare(left, environment);
	const normalizedRight = normalizeSessionPathForCompare(right, environment);
	return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}
