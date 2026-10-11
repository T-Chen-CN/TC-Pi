/** 当前仓库文件读取：GitHub raw 与 contents API 共用同一仓库、分支和校验。 */
import { UPDATE_REPO, UPDATE_REPO_OWNER } from "../../shared/updateSources";
import type { UpdateSourceId } from "../../shared/types/settings";

/** 源候选条目：`id` 供日志/兜底判断，`url` 直接交给 fetch。 */
export type RepoFileSourceEntry = { id: "github-api" | "github"; url: string };

/**
 * GitHub contents API URL：路径按段编码（保留 `/`），分支进 query 一并编码。
 * 与 GitHub raw 的路径写法保持一致，避免文件名带 `#`/空格时拼出坏 URL。
 */
export function gitHubContentsApiUrl(filePath: string, ref: string): string {
	const repoPath = `${UPDATE_REPO_OWNER}/${UPDATE_REPO}`;
	const encoded = filePath
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/");
	return `https://api.github.com/repos/${repoPath}/contents/${encoded}?ref=${encodeURIComponent(ref)}`;
}

/**
 * GitHub raw 直链（官方源优先时的首选，也是 GitHub 失败后的兜底）。
 */
export function gitHubRawFileUrl(filePath: string, ref: string): string {
	const encoded = filePath.split("/").map(encodeURIComponent).join("/");
	return `https://raw.githubusercontent.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO}/${encodeURIComponent(ref)}/${encoded}`;
}

/** raw 和 API 均锁定当前仓库；旧镜像设置只改变端点顺序，不会访问原项目。 */
export function repoFileSourceEntries(relPath: string, ref: string, source: UpdateSourceId): RepoFileSourceEntry[] {
	const api: RepoFileSourceEntry = { id: "github-api", url: gitHubContentsApiUrl(relPath, ref) };
	const github: RepoFileSourceEntry = { id: "github", url: gitHubRawFileUrl(relPath, ref) };
	return source === "github" ? [github, api] : [api, github];
}

/** contents 响应里我们认识的字段。 */
type GitHubContentsPayload = { type?: unknown; encoding?: unknown; content?: unknown };

/** 解析响应 JSON 并校验形态；不认识返回 null（含 GitHub 返回未知字段/结构变化）。 */
function parseGitHubContentsPayload(body: string): { content: string; encoding: string | null } | null {
	let payload: unknown;
	try {
		payload = JSON.parse(body);
	} catch {
		// 拿到 HTML（SPA 壳 / 网关错误页）在这里就失败，调用方换下一个源
		return null;
	}
	if (!isRecord(payload)) return null;
	const record = payload as GitHubContentsPayload;
	if (record.type !== "file" || typeof record.content !== "string") return null;
	return { content: record.content, encoding: typeof record.encoding === "string" ? record.encoding : null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 取原始字节（热更新按字节算 sha256 用）。
 * 形态不认识返回 null 而不是抛错：调用方要在多个源之间兜底，不该被解析细节打断。
 */
export function decodeGitHubContentsBuffer(body: string): Buffer | null {
	const parsed = parseGitHubContentsPayload(body);
	if (!parsed) return null;
	if (parsed.encoding === "base64") return Buffer.from(parsed.content, "base64");
	// 文档只描述 base64；其他 encoding 不认识的形态交调用方的内容校验把关
	return Buffer.from(parsed.content, "utf8");
}

/**
 * 取 UTF-8 原文（changelog / 模型目录这类纯文本用）。
 *
 * base64 解码后即 UTF-8 原文（`Buffer.from` 忽略 base64 序列里的换行，无需预处理）。
 * 任何形态异常都抛错，由调用方的逐源 try/catch 吞掉并尝试下一源。
 */
export function decodeGitHubContentsResponse(body: string): string {
	let payload: unknown;
	try {
		payload = JSON.parse(body);
	} catch {
		throw new Error("github contents response is not valid JSON");
	}
	if (!isRecord(payload)) throw new Error("github contents response has an unexpected shape");
	const record = payload as GitHubContentsPayload;
	if (record.type !== "file" || typeof record.content !== "string") {
		throw new Error("github contents response has an unexpected shape");
	}
	if (record.encoding === "base64") {
		return Buffer.from(record.content, "base64").toString("utf8");
	}
	// 文档只描述 base64；非 base64 encoding 的形态不认识，交原文给调用方校验
	return record.content;
}
