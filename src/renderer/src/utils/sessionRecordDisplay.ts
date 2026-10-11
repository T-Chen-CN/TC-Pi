import type { SessionRecord } from "../../../shared/types";

export function isDisplayableSessionRecord(session: Pick<SessionRecord, "filePath" | "backend">): boolean {
	return Boolean(session.filePath);
}
