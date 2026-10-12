import type { Project, SessionRecord } from "../../../../shared/types";

export type HomeTaskState = "pending" | "error" | "starting" | "running";
export type HomeTask = { session: SessionRecord; state: HomeTaskState; pendingCount: number };
export type HomeWorkInput = {
	projects: readonly Project[];
	sessions: readonly SessionRecord[];
	runtimes: Readonly<Record<string, { agentId?: string; status: string }>>;
	pendingRequests: Readonly<Record<string, number>>;
	currentSessionId?: string;
};

/** 首页按最后活动排序，独立于工作区会话列表的创建时间顺序。 */
function byActivity(a: SessionRecord, b: SessionRecord): number {
	return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id);
}

/** 最近工作只列用户会话；父记录未加载也不提升子代理，用户 fork 则仍是独立会话。 */
function isHomeRootSession(session: SessionRecord): boolean {
	return Boolean(session.forked) || (!session.parentSessionId && !session.parentSessionPath && session.codexThreadSource !== "subagent");
}

/** 进程存在不等于任务正在运行；待答复也必须属于仍然有效的运行时。 */
function homeTask(session: SessionRecord, input: HomeWorkInput): HomeTask | undefined {
	const runtime = input.runtimes[session.id];
	if (!runtime || runtime.status === "closed" || runtime.status === "detached") return;
	const pendingCount = input.pendingRequests[session.id] ?? 0;
	if (runtime.agentId && pendingCount > 0) return { session, state: "pending", pendingCount };
	if (runtime.status === "error") return { session, state: "error", pendingCount: 0 };
	if (runtime.agentId && (runtime.status === "starting" || runtime.status === "running")) return { session, state: runtime.status, pendingCount: 0 };
	return;
}

/** 从 catalog 和轻量运行时快照派生首页入口，不改变选择、会话或进程状态。 */
export function buildHomeWork(input: HomeWorkInput) {
	const available = new Map(input.projects.filter((project) => !project.missing).map((project) => [project.id, project]));
	const availableSessions = input.sessions.filter((session) => !session.noSession && !session.supersededBy && available.has(session.projectId)).sort(byActivity);
	const sessions = availableSessions.filter(isHomeRootSession);
	const latestByProject = new Map<string, SessionRecord>();
	for (const session of sessions) if (!latestByProject.has(session.projectId)) latestByProject.set(session.projectId, session);
	// 历史入口过滤不改变任务提醒：子代理的待答复和运行状态仍须可见，避免遗漏审批。
	const tasks = availableSessions.flatMap((session) => {
		const task = homeTask(session, input);
		return task ? [task] : [];
	});
	const attention = tasks.filter((task) => task.state === "pending" || task.state === "error").sort((a, b) => Number(b.state === "pending") - Number(a.state === "pending") || byActivity(a.session, b.session));
	const running = tasks.filter((task) => task.state === "starting" || task.state === "running");
	const activityByProject = new Map<string, number>();
	for (const task of tasks) if (task.state !== "error") activityByProject.set(task.session.projectId, (activityByProject.get(task.session.projectId) ?? 0) + 1);
	const workspaces = [...available.values()]
		.filter((project) => project.kind !== "chat")
		.map((project) => ({ project, lastSession: latestByProject.get(project.id), activeCount: activityByProject.get(project.id) ?? 0 }))
		.sort((a, b) => Math.max(b.project.lastOpenedAt, b.lastSession?.updatedAt ?? 0) - Math.max(a.project.lastOpenedAt, a.lastSession?.updatedAt ?? 0) || a.project.id.localeCompare(b.project.id));
	// 回首页时保留当前会话；其被删除或目录不可用时才回退最近可恢复会话。
	const resumeSession = sessions.find((session) => session.id === input.currentSessionId) ?? sessions[0];
	const resumeProject = resumeSession ? available.get(resumeSession.projectId) : undefined;
	return {
		recentSessions: sessions.slice(0, 12),
		recentWorkspaces: workspaces.slice(0, 6),
		resumeSession,
		newSessionProjectId: resumeProject?.kind !== "chat" ? (resumeProject?.id ?? workspaces[0]?.project.id) : workspaces[0]?.project.id,
		attention,
		running,
	};
}
