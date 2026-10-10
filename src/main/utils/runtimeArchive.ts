import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve, relative } from "node:path";

/**
 * 下载器：`onProgress(receivedBytes, totalBytes|undefined)`。
 * `options.resumeFromBytes`：目标文件已有的字节数，下载器据此带 Range 续传并在其后追加写；
 * 服务端不支持 Range 时自行退回全量重下，调用方只需保证 destPath 是那个半截文件。
 */
export type RuntimeDownloader = (url: string, destPath: string, onProgress?: (received: number, total?: number) => void, signal?: AbortSignal, options?: { resumeFromBytes?: number }) => Promise<void>;

/** 解压器：把 tarball 解到 destDir（destDir 由本模块创建并保证为空）。 */
export type RuntimeExtractor = (archivePath: string, destDir: string) => Promise<void>;

/** 计算文件 sha256（小写 hex）。 */
export async function sha256OfFile(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	const stream = createReadStream(filePath);
	for await (const chunk of stream) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

/**
 * 归档内条目 → 落盘路径的安全判定（tar slip 防护）。
 * 只接受相对路径、不接受 `..` 段，且解析后必须仍在 destDir 内。
 */
export function isSafeArchiveEntry(destDir: string, entryPath: string): boolean {
	const normalized = entryPath.replace(/\\/g, "/");
	if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return false;
	if (normalized.split("/").includes("..")) return false;
	const target = resolve(destDir, normalized);
	const rel = relative(destDir, target);
	return rel === "" || (!rel.startsWith("..") && !resolve(destDir, rel).startsWith(".."));
}
