import type { SessionRecord } from "../../../shared/types";
import { normalizeWorkspacePath } from "../components/sidebar/workspaceTreeModel";
import { workspaceSessions } from "./workspaceNavigation";

export type WorkspaceSessionGroup = { session: SessionRecord; children: WorkspaceSessionGroup[] };

/** 稳定会话身份组织子 Agent；用户 fork、孤儿和循环关系仍有可达入口。 */
export function workspaceSessionGroups(records: readonly SessionRecord[], pinned: ReadonlySet<string>): WorkspaceSessionGroup[] {
	const sessions = workspaceSessions(records);
	const byId = new Map(sessions.map((session) => [session.id, session]));
	const pathKey = (session: SessionRecord, path: string) => `${session.projectId}:${session.environment}:${normalizeWorkspacePath(path)}`;
	const byPath = new Map(sessions.filter((session) => session.filePath).map((session) => [pathKey(session, session.filePath!), session]));
	const byCodexId = new Map(sessions.filter((session) => session.codexSessionId).map((session) => [session.codexSessionId, session]));
	const parents = new Map<string, string>();
	for (const session of sessions) {
		if (session.forked) continue;
		const parent =
			(session.parentSessionId ? byId.get(session.parentSessionId) : undefined) ?? (session.parentSessionPath ? byPath.get(pathKey(session, session.parentSessionPath)) : undefined) ?? (session.codexThreadSource === "subagent" && session.codexParentThreadId ? byCodexId.get(session.codexParentThreadId) : undefined);
		if (parent && parent.id !== session.id && parent.projectId === session.projectId) parents.set(session.id, parent.id);
	}
	// 先检查整条父链：切断循环成员而非依赖输入顺序，防止递归树隐藏所有入口。
	for (const session of sessions) {
		const visited = new Set([session.id]);
		let parent = parents.get(session.id);
		while (parent) {
			if (visited.has(parent)) {
				parents.delete(session.id);
				break;
			}
			visited.add(parent);
			parent = parents.get(parent);
		}
	}
	const groups = new Map<string, WorkspaceSessionGroup>(sessions.map((session) => [session.id, { session, children: [] }]));
	const roots: WorkspaceSessionGroup[] = [];
	for (const session of sessions) {
		const group = groups.get(session.id)!;
		const parentId = parents.get(session.id);
		const parent = parentId ? groups.get(parentId) : undefined;
		if (parent) parent.children.push(group);
		else roots.push(group);
	}
	const sort = (items: WorkspaceSessionGroup[]) => {
		items.sort((a, b) => Number(pinned.has(b.session.id)) - Number(pinned.has(a.session.id)) || b.session.createdAt - a.session.createdAt || a.session.id.localeCompare(b.session.id));
		for (const group of items) sort(group.children);
	};
	sort(roots);
	return roots;
}
