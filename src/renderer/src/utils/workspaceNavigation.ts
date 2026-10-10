import type { SessionRecord } from "../../../shared/types";

/** 被替换的历史和临时无记录会话不作为工作区恢复目标。 */
export function workspaceSessions(records: readonly SessionRecord[]): SessionRecord[] {
	return records.filter((record) => !record.noSession && !record.supersededBy).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

/** 先恢复记忆的稳定身份；删除或迁移后回退最近会话，空工作区不自动创建。 */
export function workspaceLandingSession(records: readonly SessionRecord[], rememberedId?: string): SessionRecord | undefined {
	const sessions = workspaceSessions(records);
	return sessions.find((record) => record.id === rememberedId) ?? sessions[0];
}
