import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeGitHubContentsBuffer, repoFileSourceEntries, type RepoFileSourceEntry } from "../update/repoContents";
import type { UpdateSourceId } from "../../shared/types/settings";
import type { BuiltInExtensionsCheckResult, BuiltInExtensionsUpdateResult, BuiltInExtensionsUpdateStatus } from "../../shared/types/extensionsUpdate";
import { BUILT_IN_EXTENSIONS_OVERLAY_BACKUP_DIR_NAME, BUILT_IN_EXTENSIONS_OVERLAY_DIR_NAME, EXTENSIONS_MANIFEST_FILE_NAME, listExtensionFileNames, readManifestFromDir, readVerifiedArtifact, sha256Of, parseBuiltInExtensionsManifest, type BuiltInExtensionsManifest } from "./builtInExtensionsManifest";
// 覆盖层可用性在路径解析侧按目录缓存（校验要读全部文件），写盘后必须显式失效，
// 否则本次更新要等重启才参与 -e 注入。
import { invalidateBuiltInExtensionsOverlayCache } from "./builtInExtensions";

/** 清单所在分支：main（发行分支，与模型目录更新一致）。 */
export const BUILT_IN_EXTENSIONS_UPDATE_DEFAULT_BRANCH = "main";
/** IPC 边界白名单：只接受 main/dev，防 URL 注入。 */
export const BUILT_IN_EXTENSIONS_UPDATE_ALLOWED_BRANCHES = ["main", "dev"] as const;

/** 扩展目录在仓库中的相对路径（与 resources/extensions 一致）。 */
const EXTENSIONS_REPO_DIR = "resources/extensions";

/** 源候选（GitHub contents API / github raw）；形态与 update/repoContents 共用，避免两处各定义一份。 */
type SourceEntry = RepoFileSourceEntry;

/** 最小响应形状：支持流式 body（undici/Node fetch 必有）或整体 arrayBuffer（测试替身）。 */
type ResponseBodyLike = {
	getReader(): {
		read(): Promise<{ done?: boolean; value?: Uint8Array }>;
		cancel(): Promise<void>;
	};
};
type ResponseLike = {
	body?: ResponseBodyLike | null;
	arrayBuffer?(): Promise<ArrayBuffer>;
};

export type BuiltInExtensionsUpdaterOptions = {
	/** 应用 userData 目录：覆盖层落在它下面（打包态可写）。 */
	userDataDir: string;
	/** 随包分发的内置扩展目录（dev 与打包态由调用方用同一 roots 解析）。 */
	builtinExtensionsDir: string;
	/** 网络实现注入（单测）；默认 globalThis.fetch。 */
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	maxManifestBytes?: number;
	maxFileBytes?: number;
	/** 默认分支，默认 main。 */
	branch?: string;
	/** 更新源：github 时 GitHub raw 直连优先，否则 GitHub API OpenAPI 优先。 */
	source?: () => UpdateSourceId;
};

export class BuiltInExtensionsUpdater {
	private readonly userDataDir: string;
	private readonly builtinExtensionsDir: string;
	private readonly fetchImpl: typeof fetch;
	private readonly timeoutMs: number;
	private readonly maxManifestBytes: number;
	private readonly maxFileBytes: number;
	private readonly branch: string;
	private readonly source: () => UpdateSourceId;

	constructor(options: BuiltInExtensionsUpdaterOptions) {
		this.userDataDir = options.userDataDir;
		this.builtinExtensionsDir = options.builtinExtensionsDir;
		this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
		this.timeoutMs = options.timeoutMs ?? 15_000;
		this.maxManifestBytes = options.maxManifestBytes ?? 256 * 1024;
		this.maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
		this.branch = options.branch ?? BUILT_IN_EXTENSIONS_UPDATE_DEFAULT_BRANCH;
		this.source = options.source ?? (() => "github");
	}

	/** 覆盖层目录绝对路径（无论是否存在）。 */
	resolveOverlayDir(): string {
		return join(this.userDataDir, BUILT_IN_EXTENSIONS_OVERLAY_DIR_NAME);
	}

	/** 覆盖层有效则返回它，否则 null（供启动链路决定是否覆盖内置路径）。 */
	resolveEffectiveOverlayDir(): string | null {
		const overlayDir = this.resolveOverlayDir();
		return readVerifiedArtifact(overlayDir) ? overlayDir : null;
	}

	/** 当前生效版本号：覆盖层优先，否则内置；都无效为 null。 */
	effectiveVersion(): string | null {
		return this.effectiveManifest()?.version ?? null;
	}

	/**
	 * 当前生效的扩展目录：覆盖层校验通过则指向它，否则随包内置目录。
	 * 供「打开目录」使用——路径由主进程解析，渲染层只发意图。
	 */
	resolveEffectiveExtensionsDir(): string {
		return this.effectiveDir();
	}

	getStatus(): BuiltInExtensionsUpdateStatus {
		const builtin = readVerifiedArtifact(this.builtinExtensionsDir);
		const overlayDir = this.resolveOverlayDir();
		const overlay = readVerifiedArtifact(overlayDir);
		return {
			builtin: builtin ? { version: builtin.version, fileCount: builtin.fileCount } : null,
			overlay: overlay ? { version: overlay.version, fileCount: overlay.fileCount } : null,
			hasOverlayFiles: existsSync(overlayDir),
			hasBackup: existsSync(this.backupDir()),
			effectiveVersion: overlay?.version ?? builtin?.version ?? null,
			overlayDir: existsSync(overlayDir) ? overlayDir : null,
		};
	}

	/** 检查远端是否有更新：以**逐文件 sha256** 判定，不依赖版本号是否被 bump。 */
	async checkRemote(branch?: string): Promise<BuiltInExtensionsCheckResult> {
		const manifestText = await this.downloadManifest(branch ?? this.branch);
		if (!manifestText.ok) {
			return { ok: false, code: "network", message: manifestText.message, hasUpdate: false };
		}
		const remote = parseBuiltInExtensionsManifest(manifestText.text);
		if (!remote) {
			return { ok: false, code: "validation", message: "remote extensions manifest is invalid", hasUpdate: false };
		}
		const changedFiles = this.diffAgainstLocal(remote);
		return {
			ok: true,
			remoteVersion: remote.version,
			localVersion: this.effectiveManifest()?.version ?? null,
			hasUpdate: changedFiles.length > 0,
			changedFiles,
		};
	}

	/**
	 * 更新到远端最新：拉清单 → 比对 sha → 只下载有差异的文件（其余从当前生效源复制）
	 * → 整体校验 → 原子替换覆盖层。已是最新时不写盘。
	 */
	async update(branch?: string): Promise<BuiltInExtensionsUpdateResult> {
		const resolvedBranch = branch ?? this.branch;
		const manifestText = await this.downloadManifest(resolvedBranch);
		if (!manifestText.ok) {
			return { ok: false, code: "network", message: manifestText.message, updated: false };
		}
		const remote = parseBuiltInExtensionsManifest(manifestText.text);
		if (!remote) {
			return { ok: false, code: "validation", message: "remote extensions manifest is invalid", updated: false };
		}
		const changedFiles = this.diffAgainstLocal(remote);
		if (changedFiles.length === 0) {
			return { ok: true, updated: false, version: remote.version };
		}
		try {
			const filesWritten = await this.writeOverlay(remote, changedFiles, resolvedBranch);
			invalidateBuiltInExtensionsOverlayCache();
			return { ok: true, updated: true, version: remote.version, filesWritten };
		} catch (error) {
			return {
				ok: false,
				code: "write",
				message: `failed to write extensions overlay: ${error instanceof Error ? error.message : String(error)}`,
				updated: false,
			};
		}
	}

	/** 一键还原：把覆盖层整体转存 `.bak`，回到随包分发的内置版本。 */
	restoreBuiltin(): BuiltInExtensionsUpdateResult {
		const overlayDir = this.resolveOverlayDir();
		if (!existsSync(overlayDir)) return { ok: true, updated: false };
		try {
			const backupDir = this.backupDir();
			rmSync(backupDir, { recursive: true, force: true });
			renameSync(overlayDir, backupDir);
			invalidateBuiltInExtensionsOverlayCache();
			return { ok: true, updated: true, version: this.effectiveVersion() ?? undefined };
		} catch (error) {
			return {
				ok: false,
				code: "write",
				message: `failed to restore built-in extensions: ${error instanceof Error ? error.message : String(error)}`,
				updated: false,
			};
		}
	}

	/** 恢复上一个覆盖版（`.bak` 校验通过才写回）。 */
	restorePrevious(): BuiltInExtensionsUpdateResult {
		const backupDir = this.backupDir();
		if (!existsSync(backupDir)) {
			return { ok: false, code: "validation", message: "no previous extensions overlay found", updated: false };
		}
		if (!readVerifiedArtifact(backupDir)) {
			return { ok: false, code: "validation", message: "backup overlay failed verification", updated: false };
		}
		try {
			const overlayDir = this.resolveOverlayDir();
			rmSync(overlayDir, { recursive: true, force: true });
			renameSync(backupDir, overlayDir);
			invalidateBuiltInExtensionsOverlayCache();
			return { ok: true, updated: true, version: readManifestFromDir(overlayDir)?.version ?? undefined };
		} catch (error) {
			return {
				ok: false,
				code: "write",
				message: `failed to restore previous overlay: ${error instanceof Error ? error.message : String(error)}`,
				updated: false,
			};
		}
	}

	private backupDir(): string {
		return join(this.userDataDir, BUILT_IN_EXTENSIONS_OVERLAY_BACKUP_DIR_NAME);
	}

	/** 当前生效的 artifact 清单（覆盖层有效优先，否则内置）。 */
	private effectiveManifest(): BuiltInExtensionsManifest | null {
		const overlay = readVerifiedArtifact(this.resolveOverlayDir());
		if (overlay) return overlay;
		return readVerifiedArtifact(this.builtinExtensionsDir);
	}

	/** 当前生效源目录（用于复制未变化的文件）。 */
	private effectiveDir(): string {
		return readVerifiedArtifact(this.resolveOverlayDir()) ? this.resolveOverlayDir() : this.builtinExtensionsDir;
	}

	/**
	 * 本地生效文件 → sha256 映射。
	 * 清单不可用时退回扫目录现算，保证「内置清单缺失」的旧安装包也能更新。
	 */
	private localFileShas(): Map<string, string> {
		const manifest = this.effectiveManifest();
		// An old overlay cannot reintroduce files removed from this distribution.
		// Include bundled helpers as well as entry points so snapshots stay complete.
		const overlayShas = new Map(manifest?.files.map((file) => [file.name, file.sha256]));
		const shas = new Map<string, string>();
		for (const name of listExtensionFileNames(this.builtinExtensionsDir)) {
			try {
				shas.set(name, overlayShas.get(name) ?? sha256Of(readFileSync(join(this.builtinExtensionsDir, name))));
			} catch {
				// 读不到就当作不在集合里（该文件本次不参与比对，也就不会被更新）
			}
		}
		return shas;
	}

	/** 远端清单里「本地认识且内容不同」的文件名。本地不认识的新文件名一律忽略。 */
	private diffAgainstLocal(remote: BuiltInExtensionsManifest): string[] {
		const local = this.localFileShas();
		const changed: string[] = [];
		for (const file of remote.files) {
			if (!local.has(file.name)) continue;
			if (local.get(file.name) !== file.sha256) changed.push(file.name);
		}
		return changed;
	}

	/**
	 * 写覆盖层：tmp 目录组装 → 整体校验 → 原子替换。
	 * 覆盖层清单只声明实际落盘的文件（本地认识的子集），保证 readVerifiedArtifact 能通过。
	 */
	private async writeOverlay(remote: BuiltInExtensionsManifest, changedFiles: string[], branch: string): Promise<number> {
		const overlayDir = this.resolveOverlayDir();
		const tmpDir = `${overlayDir}.tmp`;
		const localShas = this.localFileShas();
		const changed = new Set(changedFiles);
		const sourceDir = this.effectiveDir();
		const written: { name: string; sha256: string; bytes: number }[] = [];

		rmSync(tmpDir, { recursive: true, force: true });
		mkdirSync(tmpDir, { recursive: true });
		try {
			for (const file of remote.files) {
				// 本地不认识的文件名不落盘：注入清单编译在应用里，热更新不该引入新代码
				if (!localShas.has(file.name)) continue;
				const target = join(tmpDir, file.name);
				if (changed.has(file.name)) {
					const buffer = await this.downloadFileBuffer(file.name, branch);
					const actualSha = sha256Of(buffer);
					if (actualSha !== file.sha256) {
						throw new Error(`downloaded ${file.name} failed sha256 verification`);
					}
					writeFileSync(target, buffer);
				} else {
					// 未变化：从当前生效源复制，保证覆盖层自洽（扩展间相对 import 可解析）
					const source = join(sourceDir, file.name);
					copyFileSync(existsSync(source) ? source : join(this.builtinExtensionsDir, file.name), target);
				}
				written.push({ name: file.name, sha256: file.sha256, bytes: file.bytes });
			}
			if (written.length === 0) throw new Error("no updatable file found in remote manifest");

			const overlayManifest: BuiltInExtensionsManifest = {
				schemaVersion: remote.schemaVersion,
				version: remote.version,
				// 来源标识：本快照取自该远端版本（本地完整性由逐文件 sha256 保证，不依赖此字段）
				bundleSha256: remote.bundleSha256,
				fileCount: written.length,
				files: written,
			};
			writeFileSync(join(tmpDir, EXTENSIONS_MANIFEST_FILE_NAME), `${JSON.stringify(overlayManifest, null, 2)}\n`, "utf8");
			if (!readVerifiedArtifact(tmpDir)) throw new Error("overlay failed verification after write");
			this.swapOverlay(tmpDir);
			return written.length;
		} catch (error) {
			rmSync(tmpDir, { recursive: true, force: true });
			throw error;
		}
	}

	/**
	 * 原子替换：现有覆盖层转 `.bak` → tmp 顶上。
	 * 第二步失败时尝试把 `.bak` 还原为覆盖层，避免「更新失败反而丢掉当前生效版本」。
	 */
	private swapOverlay(tmpDir: string): void {
		const overlayDir = this.resolveOverlayDir();
		const backupDir = this.backupDir();
		if (existsSync(overlayDir)) {
			rmSync(backupDir, { recursive: true, force: true });
			renameSync(overlayDir, backupDir);
		}
		try {
			renameSync(tmpDir, overlayDir);
		} catch (error) {
			if (existsSync(backupDir) && !existsSync(overlayDir)) {
				try {
					renameSync(backupDir, overlayDir);
				} catch {
					// 回滚也失败：退回内置版本（功能可用，只是丢了上次覆盖版），错误继续上抛
				}
			}
			throw error;
		}
	}

	/**
	 * 源顺序：GitHub 源时 raw 直连优先，否则 GitHub API OpenAPI 优先（国内直连更稳）。
	 * URL 构造与 base64 解码统一在 update/repoContents.ts——GitHub API 不能走
	 * `/<owner>/<repo>/raw/<ref>/<path>`（已被 GitCode 前端接管，返回 SPA HTML）。
	 */
	private sourceEntries(relPath: string, branch: string): SourceEntry[] {
		return repoFileSourceEntries(relPath, branch, this.source());
	}

	private async downloadManifest(branch: string): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
		let lastError: unknown;
		for (const entry of this.sourceEntries(`${EXTENSIONS_REPO_DIR}/${EXTENSIONS_MANIFEST_FILE_NAME}`, branch)) {
			try {
				return { ok: true, text: await this.downloadText(entry, this.maxManifestBytes) };
			} catch (error) {
				lastError = error;
			}
		}
		return {
			ok: false,
			message: `extensions manifest download failed from all sources: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
		};
	}

	private async downloadFileBuffer(name: string, branch: string): Promise<Buffer> {
		let lastError: unknown;
		for (const entry of this.sourceEntries(`${EXTENSIONS_REPO_DIR}/${name}`, branch)) {
			try {
				const buffer = await this.downloadBinary(entry.url, this.maxFileBytes);
				if (entry.id === "github-api") {
					const decoded = decodeGitHubContentsBuffer(buffer.toString("utf8"));
					if (!decoded) throw new Error("atomgit contents response has an unexpected shape");
					return decoded;
				}
				return buffer;
			} catch (error) {
				lastError = error;
			}
		}
		throw lastError ?? new Error(`no download sources configured for ${name}`);
	}

	private async downloadText(entry: SourceEntry, maxBytes: number): Promise<string> {
		const buffer = await this.downloadBinary(entry.url, maxBytes);
		if (entry.id === "github-api") {
			const decoded = decodeGitHubContentsBuffer(buffer.toString("utf8"));
			if (!decoded) throw new Error("atomgit contents response has an unexpected shape");
			return decoded.toString("utf8");
		}
		return buffer.toString("utf8");
	}

	private async downloadBinary(url: string, maxBytes: number): Promise<Buffer> {
		const controller = new AbortController();
		// 超时中止同样覆盖 DNS/连接挂起阶段，避免设置页长时间转圈
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const response = await this.fetchImpl(url, {
				signal: controller.signal,
				redirect: "follow",
				headers: { "user-agent": "TC-Pi-extensions-updater" },
			});
			if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
			return await this.readBodyWithCap(response, maxBytes, controller, url);
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * 流式读取响应体并按 maxBytes 提前中止：
	 * - 有 body（undici ReadableStream）：增量累计，超限立刻 controller.abort() 断开连接 + reader.cancel()。
	 * - 无 body（测试替身 / 受限运行时）：回落 arrayBuffer() 整读 + 事后校验（原行为）。
	 * 用 getReader().read() 循环而非 for-await：本模块在测试经 vm 沙箱加载时，
	 * 沙箱与宿主的 Symbol.asyncIterator 分属不同 realm，for-await 跨 realm 会静默失败。
	 */
	private async readBodyWithCap(response: ResponseLike, maxBytes: number, controller: AbortController, url: string): Promise<Buffer> {
		const body = response.body;
		if (body && typeof body.getReader === "function") {
			const reader = body.getReader();
			const chunks: Buffer[] = [];
			let total = 0;
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value || typeof value.byteLength !== "number" || value.byteLength === 0) continue;
				total += value.byteLength;
				if (total > maxBytes) {
					// 先 abort 断网再 cancel reader：宁可连接复位，也不把剩余字节拉进内存
					controller.abort();
					try {
						await reader.cancel();
					} catch {
						// 连接已随 abort 关闭
					}
					throw new Error(`response too large (over ${maxBytes} bytes) for ${url}`);
				}
				chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
			}
			return Buffer.concat(chunks);
		}
		if (typeof response.arrayBuffer !== "function") {
			throw new Error(`response without readable body for ${url}`);
		}
		const buffer = Buffer.from(await response.arrayBuffer());
		if (buffer.byteLength > maxBytes) {
			throw new Error(`response too large (${buffer.byteLength} bytes) for ${url}`);
		}
		return buffer;
	}
}
