import { requireSupportedBackend } from "../../shared/productFeatures";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentBackend, AgentTab, SessionEnvironment, SessionModelPreference, SessionRecord, SessionSource, SessionSummary } from "../../shared/types";
import type { SessionProxyOverride } from "../../shared/types/session";
import { getAppLogger } from "../logging/sharedLogger";
import { renameWithRetry } from "../utils/fsRetry";
import { buildSessionOriginKey, buildSummaryOriginKey, canonicalizeSessionPath, collectSessionSubtreeIds, getImportedSessionSourceId, getSessionEnvironment, isInSubagentArtifactsDir, looksLikeCodexSessionFileStem, looksLikePiSessionFileStem } from "../../shared/sessionIdentity";
import { looksLikeExpandedRefBlockTitle } from "../../shared/expandedRefBlocks";
import { createSessionModelPreference } from "../../shared/modelDisplayName";

/**
 * 会话标题所有权来源（#266 时序抽奖修复）：
 * - undefined：未确认，仍可被第一个自动/补名结果领取一次；
 * - "fallback"：内容派生兜底名（首条消息 / 扫描弱回退），可被 "auto" 升级覆盖；
 * - "auto"：内置扩展经 marker 校验的模型自动命名，终态；
 * - "manual"：用户改名 / 导入 / claimTitleOwnership 预留，终态；
 * - "legacy"：旧 catalog 迁移来的存量条目（titleLocked=true 而来源无法区分，或压根没写 titleLocked）。
 *   授权语义同 manual（一律挡住自动写入），额外允许一次指纹修复：命中 #266 误锁时改用
 *   JSONL 权威名（见 repairedLegacyFallbackTitle）。读过一次盘（无论命中与否）即转 manual 终态，
 *   不再重复读盘；读盘失败保持 legacy 等下次扫描再试。
 */
export type SessionTitleOrigin = "fallback" | "auto" | "manual" | "legacy";

export type SessionCatalogEntry = {
	id: string;
	projectId: string;
	originKey?: string;
	title: string;
	/**
	 * PiDeck owns the display title once this is true. Only an unclaimed fresh
	 * provisional title may accept one automatic or initial JSONL title; pi JSONL/TUI
	 * changes never overwrite an owned catalog title.
	 * titleOrigin 存在时它才是所有权来源的权威，本字段仅作镜像（旧读取路径兼容）。
	 */
	titleLocked?: boolean;
	/** 标题所有权来源；见 SessionTitleOrigin。 */
	titleOrigin?: SessionTitleOrigin;
	/** Anonymous entries are in-memory only and are never written to session-catalog.json. */
	noSession?: boolean;
	source: SessionSource;
	environment: SessionEnvironment;
	/** 运行时后端；缺省 "pi"（旧 catalog 数据兼容）。 */
	backend?: AgentBackend;
	filePath?: string;
	wslDistro?: string;
	wslUser?: string;
	importedSourceId?: string;
	status: "draft" | "active";
	/** 子会话标记：扫描时从 SessionSummary 继承，持久化供 getRecord/listEntries 重建（不丢树形） */
	parentSessionPath?: string;
	/**
	 * fork 会话标记（pi fork/clone 产物，文件头带 parentSession）：
	 * 与 parentSessionPath 独立（后者=子代理折叠关系），仅作 fork 身份元数据——
	 * (fork) 标题后缀由 fork 完成时物理写入会话名（sessionForkTitle.ts），不靠该标记拼装。
	 */
	forked?: boolean;
	/** 重发/编辑 fork 化替换标记：本会话已被 fork 出的子会话接替（值=子会话稳定 id），列表默认过滤。 */
	supersededBy?: string;
	model?: SessionModelPreference;
	thinkingLevel?: string;
	piSessionId?: string;

	proxy?: SessionProxyOverride;
	/**
	 * 手动导入钉住的项目归属（外置目录导入）：置位后自动扫描不得把该会话改回原目录对应的项目。
	 * 场景：项目目录被移动/改名后，用户手动把旧路径下的会话导入到新项目；
	 * 旧项目若仍留在侧栏，它的常规扫描会把属于旧 encoded 目录的会话抢回去，
	 * 表现为「导入后刷新一下又不见了」。置位后该条目只由用户操作改归属（重新导入/删除）。
	 */
	manualProjectAssignment?: boolean;
	createdAt: number;
	updatedAt: number;
};

type SessionCatalogFile = {
	version: 1;
	sessions: SessionCatalogEntry[];
};

type SessionCatalogContext = {
	wslDistro?: string;
	wslUser?: string;
};

/**
 * 将 catalog 条目 filePath 归一化为绝对路径（可选注入）。
 * pi 可能上报相对 cwd 的 sessionFile（如 sessionDir 配置为 ".pi/sessions"），
 * 与扫描器发现的绝对路径 originKey 不同，会造成同文件双记录（侧栏重复显示）。
 * 注入后 catalog 在加载与写入边界统一修正；实现见 main/index.ts。
 */
export type SessionFilePathResolver = (projectId: string, filePath: string, environment: SessionEnvironment) => string;

/** 会话标题读取与有效性校验的合并结果：name 仅用于首次索引或未确认的 provisional 标题；
 * valid:false 表示文件非有效 Pi 会话（如 pi-subagents transcript 转储，首条记录用 recordType 而无 type 头），
 * mergeScanned 应拒绝索引该文件（#168）；parentSessionPath 仅供平铺子代理形态
 * （@tintinweb/pi-subagents：parentSession header + 会话名 <agent>#<8hex>）回填父关系，
 * 用户 fork / 普通会话 / nicobailon 嵌套形态不返回该值。
 * forked 为 pi fork/branch 探测结果（parentSession header + 非 tintinweb 形态）：
 * 只做列表 (fork) 标记，不影响 parentSessionPath 的折叠语义。 */
export type SessionTitleFetchResult = { name?: string; nameFromSessionInfo?: boolean; valid?: boolean; parentSessionPath?: string; forked?: boolean; fallbackName?: string; firstUserText?: string };

/** collectScannedTitles 收集的补名结果：fromSessionInfo=false 表示首条消息弱回退，所有权只算 fallback（#266）。
 *  fallbackName 是本文件的弱兜底候选（首条 user/assistant 文本），与最终 name 取谁无关：
 *  #266 存量自愈要用它比对「catalog 里存的这一行是不是当年被误锁的首句兜底」。 */
type ScannedTitleFetch = { name: string; fromSessionInfo: boolean; fallbackName?: string };

/** legacy 存量条目的一次性探测结果：authoritative 只在真读到权威 session_info 名时才有值。
 *  firstUserText 是「文件内真首句」（可选，按需读取）：头/尾窗口兜底在系统提示很大的会话里会
 *  退化成尾部消息，指纹比对需要它才能命中当年写进 catalog 的真首句（#266）。 */
type LegacyTitleProbe = { authoritative?: string; fallback?: string; firstUserText?: string };

export type SessionTitleFetchOptions = {
	/** false = only inspect the bounded header for structural metadata; do not read name windows. */
	includeTitle?: boolean;
	/** true = 额外有界读取「文件内首条 user 文本」（legacy 存量自愈的第二指纹基准，见 #266）。 */
	includeFirstUserText?: boolean;
};

/** 标题刷新 + 会话头有效性校验：装配层注入（实现为 SessionScanner.inferSessionNameAndValidity，
 * 见 main/index.ts）。读取结果为首次发现和未确认 provisional 标题提供初始化值；已有 catalog 标题
 * 不再跟随 pi-tui /name 或 JSONL 的后续变化。 */
export type SessionTitleFetcher = (filePath: string, options?: SessionTitleFetchOptions) => Promise<SessionTitleFetchResult>;

/** 扫描未读正文时没有 session_info。pi JSONL 文件名是时间戳，不能当标题，否则侧栏全是日期。 */
function scannedFileStemTitle(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");
	const base = normalized.slice(normalized.lastIndexOf("/") + 1);
	const stem = base.replace(/\.jsonl$/i, "").trim();
	if (!stem || looksLikePiSessionFileStem(stem)) return "Untitled";
	return stem;
}

/**
 * 外部删除判定的锚点：从 filePath 父目录逐级向上，返回第一个真实存在的祖先目录；
 * 一路到文件系统根都不存在（或超过爬升上限）返回 undefined。
 * 爬升上限 6：嵌套子代理会话最深结构为 <encoded>/<父会话目录>/<agentId>/run-N/session.jsonl，
 * 从 run-N 爬到 encoded 需 4 层，留 2 层余量；网络盘/移动盘掉线时 2-3 层内即到根停下。
 */
function findExistingAncestorDir(filePath: string, maxDepth = 6): string | undefined {
	let dir = dirname(filePath);
	for (let depth = 0; depth < maxDepth; depth += 1) {
		if (existsSync(dir)) return dir;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
	return undefined;
}

/** 侧栏/Tab 展示用：pi 文件名时间戳不是会话名。 */
function catalogDisplayTitle(title: string | undefined): string | undefined {
	if (!title) return undefined;
	return looksLikePiSessionFileStem(title) ? undefined : title;
}

/** 占位标题判定：catalog 无真实名称时落成 Untitled（pi 时间戳 stem 加载时也被清成它），
 *  只有这类标题才值得读头部补名，否则每次扫描都会重复读盘。 */
function isPlaceholderCatalogTitle(title: string | undefined): boolean {
	if (!title) return true;
	if (looksLikePiSessionFileStem(title)) return true;
	// 未折叠的块原文标题（`<prompt_template …>` 等历史脏数据）同样是占位名：
	// 允许首次补名把它换成用户可识别的标题，否则它会一直留在侧栏。
	if (looksLikeExpandedRefBlockTitle(title)) return true;
	return /^(?:untitled(?: session)?|new session|新会话)$/i.test(title);
}

/**
 * 解析条目的所有权来源。新字段优先；旧 catalog 只有 titleLocked 时惰性推导为 legacy——
 * true 无法区分「手动」与「扩展自动」，行为按 manual（绝不把已有标题降级成可覆盖），
 * 但保留一次指纹修复机会（#266 存量被误锁的首句兜底，见 repairedLegacyFallbackTitle）。
 */
function resolveTitleOrigin(entry: Pick<SessionCatalogEntry, "title" | "titleLocked" | "titleOrigin">): SessionTitleOrigin | undefined {
	if (entry.titleOrigin === "fallback" || entry.titleOrigin === "auto" || entry.titleOrigin === "manual" || entry.titleOrigin === "legacy") return entry.titleOrigin;
	if (entry.titleLocked === false) return undefined;
	// 缺 titleOrigin 只有 locked=true：存量条目来源未知，标成 legacy 等一次指纹修复机会（#266）。
	if (entry.titleLocked === true) return "legacy";
	return isPlaceholderCatalogTitle(entry.title) ? undefined : "legacy";
}

/** 缺省是旧 catalog：真实标题默认已由 PiDeck 确认；仅占位标题保留一次初始化机会。 */
function isTitleLocked(entry: Pick<SessionCatalogEntry, "title" | "titleLocked" | "titleOrigin">): boolean {
	// 历史 Codex rollout 文件名标题（旧导入器拿不到会话名时的兑底产物）永远不算锁定：
	// 即使旧 catalog 曾把它写成 locked=true，也要允许重导入后的真实标题覆盖，
	// 否则存量脏标题（看起来就是一串会话 ID）永久无法修复。
	if (looksLikeCodexSessionFileStem(entry.title)) return false;
	return resolveTitleOrigin(entry) !== undefined;
}

/** 一次性写入所有权字段：titleLocked 始终是 titleOrigin 的镜像，旧读取路径不会看到半截状态。 */
function assignTitleOrigin(entry: SessionCatalogEntry, origin: SessionTitleOrigin | undefined): void {
	if (origin) {
		entry.titleOrigin = origin;
		entry.titleLocked = true;
		return;
	}
	delete entry.titleOrigin;
	entry.titleLocked = false;
}

/**
 * #266 存量自愈的指纹判定（纯函数，可直接单测）。
 *
 * 为什么需要指纹：旧 catalog 的 titleLocked=true 条目来源不可区分——既可能是用户改名，
 * 也可能是被缺陷版本 `titleLocked: !isPlaceholderCatalogTitle(initialTitle)` 误锁的首句兜底。
 * 三条指纹同时成立才判定为后者，把误丢的权威名拿回来：
 * 1. 条目来源是 legacy（只有旧 catalog 迁移来的条目走这条路；auto/manual 不参与）；
 * 2. catalog 现存标题逐字等于本次扫描读到的弱兜底候选（首条 user/assistant 文本，或文件内真首句）——
 *    用户手动改成与首句一字不差的标题几乎不可能；
 * 3. JSONL 里存在不同的权威 session_info 名，即当年被 applyAutomaticTitle 丢弃的那个名字。
 *
 * 为什么候选有两条：头/尾窗口的兜底在系统提示很大的会话里会落到尾部消息上（真首句落在 64KB
 * 头窗口之外），只比它会让这类 #266 存量永远修不了；firstUserText 是文件内真首句（有界读取）。
 *
 * @returns 要写回的权威标题；不命中返回 undefined（保持原标题，并转终态不再探测）。
 */
function repairedLegacyFallbackTitle(entry: Pick<SessionCatalogEntry, "title">, probe: { authoritative?: string; fallback?: string; firstUserText?: string }): string | undefined {
	const authoritative = catalogDisplayTitle(probe.authoritative);
	if (!authoritative) return undefined;
	const title = normalizeFingerprintTitle(entry.title);
	if (!title) return undefined;
	const candidates = [probe.fallback, probe.firstUserText].map(normalizeFingerprintTitle).filter(Boolean);
	if (!candidates.some((candidate) => candidate === title)) return undefined;
	if (authoritative === entry.title) return undefined;
	return authoritative;
}

/** 指纹比对前的归一化：折叠空白并去首尾空白，避免换行/多空格造成的假阴性。 */
function normalizeFingerprintTitle(value: string | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 自动标题领取规则（#266）：只有未确认（undefined）或内容派生的 fallback 能被领取。
 * 扩展模型标题 "auto" 可以升级 fallback；反向（fallback 抢占已有 fallback 或终态）不可以；
 * "auto"/"manual"/"legacy" 是终态（legacy 只能被指纹修复改写），第二个自动结果一律丢弃。
 */
function claimAutomaticTitle(entry: SessionCatalogEntry, nextTitle: string, source: "auto" | "fallback"): boolean {
	const origin = resolveTitleOrigin(entry);
	if (source === "fallback" ? origin !== undefined : origin !== undefined && origin !== "fallback") return false;
	entry.title = nextTitle;
	assignTitleOrigin(entry, source);
	return true;
}

/**
 * 扫描初始化标题的所有权：占位名与历史脏名保持未锁定（留一次初始化机会）；
 * 权威 session_info 名直接终态（manual）；首条消息弱回退只算 fallback，可被扩展自动命名覆盖（#266）。
 */
function scannedTitleOrigin(title: string, authoritative: boolean): SessionTitleOrigin | undefined {
	if (isPlaceholderCatalogTitle(title) || looksLikeCodexSessionFileStem(title)) return undefined;
	return authoritative ? "manual" : "fallback";
}

function cloneModelPreference(model: SessionModelPreference | undefined): SessionModelPreference | undefined {
	return model ? createSessionModelPreference(model.provider, model.modelId, model.modelName) : undefined;
}

function cloneEntry(entry: SessionCatalogEntry): SessionCatalogEntry {
	return {
		...entry,
		model: cloneModelPreference(entry.model),
	};
}

function equalModel(left?: SessionModelPreference, right?: SessionModelPreference): boolean {
	return left?.provider === right?.provider && left?.modelId === right?.modelId;
}

function isMissingFileError(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

export function canAttachRuntimeMetadata(entry: SessionCatalogEntry | undefined, tab: Partial<AgentTab>): boolean {
	if (!entry || !tab.sessionPath) return false;

	// 写进 filePath，渲染层当成有历史去读，空会话输入时整页抽成「正在加载历史」。
	if (entry.status === "draft" && !entry.filePath) return true;
	if (!entry.filePath) return false;
	const environment = tab.sessionEnvironment ?? entry.environment;
	return (
		buildSessionOriginKey({
			source: entry.source,
			environment: entry.environment,
			filePath: entry.filePath,
			wslDistro: entry.wslDistro,
			wslUser: entry.wslUser,
			importedSourceId: entry.importedSourceId,
		}) ===
		buildSessionOriginKey({
			source: tab.sessionSource ?? entry.source,
			environment,
			filePath: tab.sessionPath,
			wslDistro: tab.wslDistro ?? entry.wslDistro,
			wslUser: tab.wslUser ?? entry.wslUser,
			importedSourceId: tab.importedSourceId ?? entry.importedSourceId,
		})
	);
}

export class SessionCatalog {
	private entries: SessionCatalogEntry[] = [];
	private loaded = false;
	private writeQueue: Promise<void> = Promise.resolve();
	private skipNextBackup = false;

	private identityContext: SessionCatalogContext;

	/** 会话活性探针（由 SessionRuntimeCoordinator 注入）：有活跃运行时绑定的会话，
	 *  其 filePath 指向的 jsonl 可能尚未由 pi 落盘，外部删除清理不得误剔。 */
	private sessionLivenessProbe?: (sessionId: string) => boolean;

	constructor(
		private readonly filePath: string,
		identityContext: SessionCatalogContext = {},
		private readonly resolveFilePath?: SessionFilePathResolver,
		private readonly fetchTitle?: SessionTitleFetcher,
	) {
		this.identityContext = { ...identityContext };
	}

	setIdentityContext(context: SessionCatalogContext): void {
		this.identityContext = { ...context };
	}

	/** 注入活性探针（main 装配时一次性接线）；传 undefined 解除。 */
	setSessionLivenessProbe(probe: ((sessionId: string) => boolean) | undefined): void {
		this.sessionLivenessProbe = probe;
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		let primaryError: unknown;
		try {
			const snapshot = await this.readCatalogFile(this.filePath);
			this.entries = snapshot.entries;
		} catch (error) {
			primaryError = error;
			try {
				const snapshot = await this.readCatalogFile(this.backupFilePath());
				this.entries = snapshot.entries;
				this.skipNextBackup = true;
			} catch (backupError) {
				if (isMissingFileError(primaryError) && isMissingFileError(backupError)) {
					this.entries = [];
				} else {
					// catalog 主文件与备份同时损坏是数据丢失信号，必须留 error 级日志供审计。
					// 不再向上抛：打包启动链会 await load()，抛错会让 whenReady 中断、窗口永不出现。
					void getAppLogger()?.error("session-catalog", "Catalog and backup both failed to load", {
						primary: primaryError instanceof Error ? primaryError.message : String(primaryError),
						backup: backupError instanceof Error ? backupError.message : String(backupError),
					});
					this.entries = [];
				}
			}
		}
		// Draft 只代表当前进程中的“尚未发送”编辑面：没有用户消息就没有
		// 可恢复的 Pi session。重启时清掉草稿，避免空 Agent 留在历史列表。
		const staleDrafts = this.entries.filter((entry) => entry.status === "draft");
		if (staleDrafts.length > 0) {
			this.entries = this.entries.filter((entry) => entry.status !== "draft");
			try {
				await this.writeSnapshot(this.entries);
			} catch {
				// 启动清理是 best-effort；内存已经不再暴露草稿，下一次启动仍会重试清理。
			}
		}

		// 兼容旧数据：pi 默认 sessionName（JSONL 文件名时间戳）曾被 onTitleChanged 写进 catalog。
		// 侧栏会显示一排日期，且 refreshAutoTitle 不再把首条消息当标题。加载时清成 Untitled。
		const timestampTitles = this.entries.filter((entry) => looksLikePiSessionFileStem(entry.title));
		if (timestampTitles.length > 0) {
			for (const entry of timestampTitles) entry.title = "Untitled";
			try {
				await this.writeSnapshot(this.entries);
			} catch {
				// 修复是 best-effort；内存已生效，下一次启动仍会重试。
			}
		}

		// 旧 catalog 没有 titleLocked/titleOrigin：已有真实标题视为 PiDeck 已确认，避免升级后被
		// 扫描或 TUI 写入反向覆盖；只有占位标题保留一次初始化/自动命名机会。
		// titleLocked=true 的存量条目无法区分手动/扩展自动，一律迁成 legacy：
		// 行为同 manual（挡住自动写入），另加一次指纹修复机会修 #266 被误锁的首句兜底。
		const missingTitleOwnership = this.entries.filter((entry) => typeof entry.titleLocked !== "boolean" || (entry.titleOrigin === undefined && entry.titleLocked === true));
		if (missingTitleOwnership.length > 0) {
			for (const entry of missingTitleOwnership) {
				if (typeof entry.titleLocked !== "boolean") entry.titleLocked = !isPlaceholderCatalogTitle(entry.title);
				if (entry.titleOrigin === undefined && entry.titleLocked === true) entry.titleOrigin = "legacy";
			}
			try {
				await this.writeSnapshot(this.entries);
			} catch {
				// 迁移失败不影响内存中的所有权规则；下次启动会继续写回。
			}
		}

		// 兼容旧数据：早期版本可能存有相对 filePath（pi 返回相对 cwd 的 sessionFile，
		// 如 sessionDir 配置为 ".pi/sessions"）。相对路径与扫描器绝对路径的 originKey
		// 不同 → 同一文件出现两条记录（侧栏重复显示），且文件操作落到错误位置。
		// 加载时用注入的 resolver 统一修正为绝对路径并重算 originKey。
		const repaired = this.repairRelativeFilePaths(this.entries);
		if (repaired) {
			this.entries = repaired;
			try {
				await this.writeSnapshot(this.entries);
			} catch {
				// 修复是 best-effort；内存已生效，下一次启动仍会重试。
			}
		}

		this.loaded = true;
		if (this.skipNextBackup) {
			// 备份自愈补写也是 best-effort：磁盘满/只读时失败只意味着下次启动重试，
			// 内存已生效；裸 await 抛错会让 whenReady 中断、窗口永不出现（同上方
			// catalog 损坏兑底声明的失败模式）。
			try {
				await this.writeSnapshot(this.entries);
			} catch (error) {
				void getAppLogger()?.warn("session-catalog", "Backup-restore snapshot write failed on startup", {
					cause: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	listEntries(): SessionCatalogEntry[] {
		this.assertLoaded();
		return this.entries.map(cloneEntry);
	}

	get(id: string): SessionCatalogEntry | undefined {
		this.assertLoaded();
		const entry = this.entries.find((candidate) => candidate.id === id);
		return entry ? cloneEntry(entry) : undefined;
	}

	getRecord(id: string): SessionRecord | undefined {
		const entry = this.get(id);
		return entry ? this.recordFromEntry(entry) : undefined;
	}

	findByFilePath(filePath: string, environment: SessionEnvironment): SessionCatalogEntry | undefined {
		this.assertLoaded();
		const target = canonicalizeSessionPath(filePath, environment);
		const entry = this.entries.find((candidate) => candidate.filePath && candidate.environment === environment && canonicalizeSessionPath(candidate.filePath, environment) === target);
		return entry ? cloneEntry(entry) : undefined;
	}

	async ensureRuntimeTarget(input: {
		projectId: string;
		title: string;
		source: SessionSource;
		environment: SessionEnvironment;
		filePath: string;
		wslDistro?: string;
		wslUser?: string;
		importedSourceId?: string;
		piSessionId?: string;
		/** fork/clone 产物注册时直接标记（parentSession 链接已由 pi 写入文件头，此处同源标记）。 */
		forked?: boolean;
		/** fork/clone 产物继承源会话的模型偏好与思考档位：子会话 JSONL 里没有新的 model_change，扫描回读拿不到，重启后模型选择器会空。 */
		model?: SessionModelPreference;
		thinkingLevel?: string;
	}): Promise<SessionCatalogEntry> {
		this.assertLoaded();
		// 与 attachRuntime 同口径：进入 catalog 前归一化为绝对路径，保证 originKey 去重一致。
		const filePath = this.resolveFilePath ? this.resolveFilePath(input.projectId, input.filePath, input.environment) : input.filePath;
		return this.enqueueMutation((entries) => {
			const originKey = buildSessionOriginKey({
				source: input.source,
				environment: input.environment,
				filePath,
				wslDistro: input.wslDistro,
				wslUser: input.wslUser,
				importedSourceId: input.importedSourceId,
			});
			let entry = entries.find((candidate) => {
				if (candidate.originKey === originKey) return true;
				if (!candidate.filePath) return false;
				return (
					buildSessionOriginKey({
						source: candidate.source,
						environment: candidate.environment,
						filePath: candidate.filePath,
						wslDistro: candidate.wslDistro,
						wslUser: candidate.wslUser,
						importedSourceId: candidate.importedSourceId,
					}) === originKey
				);
			});
			const now = Date.now();
			if (!entry) {
				entry = {
					id: randomUUID(),
					projectId: input.projectId,
					originKey,
					title: input.title,
					titleLocked: true,
					titleOrigin: "manual",
					source: input.source,
					environment: input.environment,
					filePath,
					wslDistro: input.wslDistro,
					wslUser: input.wslUser,
					importedSourceId: input.importedSourceId,
					piSessionId: input.piSessionId,
					forked: input.forked,
					model: cloneModelPreference(input.model),
					thinkingLevel: input.thinkingLevel,
					status: "active",
					createdAt: now,
					updatedAt: now,
				};
				entries.push(entry);
			} else {
				entry.projectId = input.projectId;
				entry.originKey = originKey;
				entry.source = input.source;
				entry.environment = input.environment;
				entry.filePath = filePath;
				entry.wslDistro = input.wslDistro;
				entry.wslUser = input.wslUser;
				entry.importedSourceId = input.importedSourceId;
				entry.piSessionId = input.piSessionId;
				// fork 标记只增补不清空：同一文件可能先以普通扫描注册、后经 fork 注册逻辑走到这里。
				if (input.forked) entry.forked = true;
				entry.status = "active";
				entry.updatedAt = now;
			}
			return { value: cloneEntry(entry), changed: true };
		});
	}

	async createDraft(input: {
		projectId: string;
		title: string;
		environment: SessionEnvironment;
		source?: SessionSource;
		backend?: AgentBackend;
		model?: SessionModelPreference;
		thinkingLevel?: string;
		/**
		 * Fresh drafts remain eligible for their first PiDeck automatic or JSONL title,
		 * even when the provisional UI label is not literally "Untitled". Callers that
		 * import an already named external session must opt in to final ownership with
		 * titleOrigin: "manual".
		 */
		titleOrigin?: SessionTitleOrigin;

		updatedAt?: number;
	}): Promise<SessionRecord> {
		requireSupportedBackend(input.backend);
		this.assertLoaded();
		const entry = await this.enqueueMutation((entries) => {
			const now = Date.now();
			const nextEntry: SessionCatalogEntry = {
				id: randomUUID(),
				projectId: input.projectId,
				title: input.title,

				titleLocked: input.titleOrigin !== undefined,
				titleOrigin: input.titleOrigin,
				source: input.source ?? "pi",
				environment: input.environment,
				backend: input.backend,
				wslDistro: input.environment === "wsl" ? this.identityContext.wslDistro : undefined,
				wslUser: input.environment === "wsl" ? this.identityContext.wslUser : undefined,

				// 不是「尚未发送」的草稿：置 active，重启清理/重新打开都按真实会话处理。
				status: "draft",
				model: cloneModelPreference(input.model),
				thinkingLevel: input.thinkingLevel,
				createdAt: now,
				// 外部会话导入带 mtime（真实活跃时间）；pi 草稿没有该字段，仍用当前时刻
				updatedAt: input.updatedAt ?? now,
			};
			entries.push(nextEntry);
			return { value: cloneEntry(nextEntry), changed: true };
		});
		return this.recordFromEntry(entry);
	}

	async update(
		id: string,
		patch: Partial<Pick<SessionCatalogEntry, "title" | "backend" | "updatedAt">> & {
			model?: SessionModelPreference | null;
			thinkingLevel?: string | null;
			proxy?: SessionProxyOverride | null;

			filePath?: string | null;
			piSessionId?: string | null;
			/** fork 标记：仅显式 true 时置位（fork 身份元数据；(fork) 后缀已物理写入标题）。 */
			forked?: boolean | null;
		},
	): Promise<SessionRecord> {
		requireSupportedBackend(patch.backend);
		this.assertLoaded();
		const entry = await this.enqueueMutation((entries) => {
			const nextEntry = this.requireEntry(entries, id);
			if (patch.title !== undefined) {
				nextEntry.title = patch.title;
				assignTitleOrigin(nextEntry, "manual");
			}
			if (patch.model !== undefined) nextEntry.model = cloneModelPreference(patch.model ?? undefined);
			if (patch.thinkingLevel !== undefined) nextEntry.thinkingLevel = patch.thinkingLevel ?? undefined;
			if (patch.backend !== undefined) nextEntry.backend = patch.backend;
			if (patch.filePath !== undefined) nextEntry.filePath = patch.filePath ?? undefined;
			if (patch.piSessionId !== undefined) nextEntry.piSessionId = patch.piSessionId ?? undefined;
			if (patch.forked === true) nextEntry.forked = true;
			// null = 清除覆盖恢复跟随全局
			if (patch.proxy !== undefined) nextEntry.proxy = patch.proxy ?? undefined;
			nextEntry.updatedAt = patch.updatedAt ?? Date.now();
			return { value: cloneEntry(nextEntry), changed: true };
		});
		return this.recordFromEntry(entry);
	}

	/**
	 * 领取 PiDeck 自动标题。与通用 update() 分离：迟到的自动结果不得覆盖先到的用户改名。
	 * source 区分来源（#266）：扩展模型标题 "auto" 可升级首条消息/扫描派生的 "fallback"，
	 * 反向不可；"auto" 与 "manual" 都是终态，第二个自动结果一律丢弃。
	 */
	async applyAutomaticTitle(id: string, title: string, source: "auto" | "fallback"): Promise<SessionRecord> {
		this.assertLoaded();
		const nextTitle = title.replace(/\s+/g, " ").trim();
		if (!nextTitle) throw new Error("Automatic session title is required");
		const entry = await this.enqueueMutation((entries) => {
			const nextEntry = this.requireEntry(entries, id);
			const claimed = claimAutomaticTitle(nextEntry, nextTitle, source);
			if (claimed) nextEntry.updatedAt = Date.now();
			return { value: cloneEntry(nextEntry), changed: claimed };
		});
		return this.recordFromEntry(entry);
	}

	/**
	 * Reserves catalog title ownership before a manual rename reaches pi. The rename
	 * RPC is asynchronous, so this closes the window where a pending auto-title
	 * result could otherwise claim the still-provisional record first.
	 */
	async claimTitleOwnership(id: string): Promise<SessionRecord> {
		this.assertLoaded();
		const entry = await this.enqueueMutation((entries) => {
			const nextEntry = this.requireEntry(entries, id);
			if (isTitleLocked(nextEntry)) return { value: cloneEntry(nextEntry), changed: false };
			assignTitleOrigin(nextEntry, "manual");
			nextEntry.updatedAt = Date.now();
			return { value: cloneEntry(nextEntry), changed: true };
		});
		return this.recordFromEntry(entry);
	}

	async attachRuntime(input: { sessionId: string; filePath?: string; piSessionId?: string }): Promise<SessionCatalogEntry> {
		this.assertLoaded();
		return this.enqueueMutation((entries) => {
			const entry = this.requireEntry(entries, input.sessionId);
			// #314 幂等基线：runtime 事件风暴会反复 attach 同一会话的相同路径/ID。
			// 先记录 mutation 前快照，无实际变化不得刷新 updatedAt——活动区排序与
			// 时间戳都取 updatedAt，重复刷新会让已停止/空闲会话被顶到最前、时间跳动。
			const before = {
				filePath: entry.filePath,
				piSessionId: entry.piSessionId,
				status: entry.status,
				originKey: entry.originKey,
				createdAt: entry.createdAt,
				model: entry.model,
				thinkingLevel: entry.thinkingLevel,
				importedSourceId: entry.importedSourceId,
			};
			// pi 可能上报相对 cwd 的 sessionFile：写入 catalog 前归一化为绝对路径，
			// 否则与扫描器绝对路径 originKey 不一致，同一文件会出现两条记录。
			const filePath = input.filePath && this.resolveFilePath ? this.resolveFilePath(entry.projectId, input.filePath, entry.environment) : input.filePath;

			// PiDeck 无本地会话文件。
			if (filePath) entry.filePath = filePath;
			if (input.piSessionId) entry.piSessionId = input.piSessionId;
			let mergedDuplicate = false;
			if (entry.filePath) {
				const pathUnchanged = Boolean(before.filePath && canonicalizeSessionPath(before.filePath, entry.environment) === canonicalizeSessionPath(entry.filePath, entry.environment));
				const nextOriginKey = pathUnchanged && entry.originKey ? entry.originKey : this.originKeyForEntry(entry);
				entry.originKey = nextOriginKey;
				entry.status = "active";

				const duplicateIndex = nextOriginKey ? entries.findIndex((candidate) => candidate.id !== entry.id && candidate.originKey === nextOriginKey) : -1;
				if (duplicateIndex >= 0) {
					const duplicate = entries[duplicateIndex];
					entry.model ??= duplicate.model;
					entry.thinkingLevel ??= duplicate.thinkingLevel;
					entry.importedSourceId ??= duplicate.importedSourceId;
					entry.createdAt = Math.min(entry.createdAt, duplicate.createdAt);
					entries.splice(duplicateIndex, 1);
					mergedDuplicate = true;
				}
			}
			// 快照对比逐字段判定真实变化；路径按 canonical 形态比较，隔离分隔符/大小写差异。
			const touched =
				mergedDuplicate ||
				canonicalizeSessionPath(before.filePath ?? "", entry.environment) !== canonicalizeSessionPath(entry.filePath ?? "", entry.environment) ||
				before.piSessionId !== entry.piSessionId ||
				before.status !== entry.status ||
				before.originKey !== entry.originKey ||
				before.createdAt !== entry.createdAt ||
				before.model !== entry.model ||
				before.thinkingLevel !== entry.thinkingLevel ||
				before.importedSourceId !== entry.importedSourceId;
			// 无实际变化：不刷新 updatedAt、不落盘（enqueueMutation changed:false 跳过快照），
			// 让 runtime 事件风暴里的重复 attach 成为廉价 no-op。
			if (!touched) return { value: cloneEntry(entry), changed: false };
			entry.updatedAt = Date.now();
			return { value: cloneEntry(entry), changed: true };
		});
	}

	async remove(id: string): Promise<boolean> {
		this.assertLoaded();
		return this.enqueueMutation((entries) => {
			const index = entries.findIndex((entry) => entry.id === id);
			if (index < 0) return { value: false, changed: false };
			entries.splice(index, 1);
			return { value: true, changed: true };
		});
	}

	/**
	 * 归档/删除父会话时清掉整棵子树。
	 *
	 * 磁盘侧 `SessionScanner.archive/delete` 会把 sibling `<stem>/` 一并移走，但
	 * `remove(id)` 只摘一条；`mergeScanned` 只增改不删，列表缓存会把失去父节点的
	 * 子会话孤儿提升成顶层行，再点开就是残留聊天框。草稿没有 filePath，
	 * 不会被当成后代。其它项目即使路径碰巧相似，也按 projectId 隔离。
	 */
	async removeWithDescendants(id: string): Promise<string[]> {
		this.assertLoaded();
		const parent = this.entries.find((entry) => entry.id === id);
		if (!parent) return [];
		const projectEntries = this.listEntries().filter((entry) => entry.projectId === parent.projectId);
		const ids = collectSessionSubtreeIds(projectEntries, parent);

		const persistedRemoved = await this.enqueueMutation((entries) => {
			const idSet = new Set(ids);
			const next = entries.filter((entry) => !idSet.has(entry.id));
			const actuallyRemoved = entries.filter((entry) => idSet.has(entry.id)).map((entry) => entry.id);
			if (actuallyRemoved.length === 0) return { value: [] as string[], changed: false };
			entries.splice(0, entries.length, ...next);
			return { value: actuallyRemoved, changed: true };
		});
		return persistedRemoved;
	}

	async removeByProjectId(projectId: string): Promise<number> {
		this.assertLoaded();
		return this.enqueueMutation((entries) => {
			const next = entries.filter((entry) => entry.projectId !== projectId);
			const removed = entries.length - next.length;
			if (removed === 0) return { value: 0, changed: false };
			entries.splice(0, entries.length, ...next);
			return { value: removed, changed: true };
		});
	}

	async removeByFilePath(filePath: string, environment: SessionEnvironment): Promise<boolean> {
		this.assertLoaded();
		const target = canonicalizeSessionPath(filePath, environment);
		return this.enqueueMutation((entries) => {
			const index = entries.findIndex((entry) => entry.filePath && entry.environment === environment && canonicalizeSessionPath(entry.filePath, environment) === target);
			if (index < 0) return { value: false, changed: false };
			entries.splice(index, 1);
			return { value: true, changed: true };
		});
	}

	async mergeScanned(
		projectId: string,
		summaries: SessionSummary[],
		context: SessionCatalogContext = this.identityContext,
		options: {
			/**
			 * 本次并入来自用户手动导入（外置目录导入）：命中条目打上 manualProjectAssignment，
			 * 之后别的项目扫描不得把归属改回去。
			 */
			manualAssignment?: boolean;
		} = {},
	): Promise<SessionRecord[]> {
		this.assertLoaded();
		// 新发现文件用 pi JSONL 标题初始化 catalog；一旦 catalog 已有记录，后续扫描
		// 只更新文件身份、预览和结构元数据，不能用 pi/TUI 的标题覆盖 PiDeck 名称。
		// 同一次读取仍校验会话头：invalidOrigins 收集非有效会话文件，下面据此清洗与拒绝。
		const { titles: fetchedTitles, legacyProbes: fetchedLegacyProbes, invalid: invalidOrigins, parents: fetchedParents, forked: fetchedForked } = await this.collectScannedTitles(summaries, context);

		// 外部删除清理（在入锁前完成磁盘探测）：mergeScanned 历史上只增改不删，
		// pi 会话文件被外部删除（pi 回收站、用户手工 rm、脚本清理）后条目会永远
		// 残留在侧栏。安全闸（缺一不可）：

		// - environment=native：WSL 条目跳过——发行版未运行时 UNC existsSync 恒
		//   false，会把正常会话误删；
		// - 必须真实 existsSync 缺失（而非「不在本轮 summaries 里」），部分扫描/
		//   手动导入调用不会误判；
		// - 必须有存在的祖先目录锚点：从父目录逐级向上找第一个存在的目录，找到
		//   即「磁盘可达而文件不在」= 确定的外部删除；一路到根都不存在（磁盘/
		//   网络盘整体离线、路径临时不可达）才跳过。只看直接父目录会把嵌套子
		//   代理会话（<encoded>/<父会话目录>/<agentId>/run-N/session.jsonl）漏掉——
		//   父会话目录被整体删除后多级父目录都不在，记录永远残留并会在小窗
		//   报 ENOENT（2027-02 事故）。
		const externallyMissingIds = new Set<string>();
		for (const entry of this.entries) {
			if (entry.projectId !== projectId) continue;
			if (entry.source !== "pi") continue;
			if (entry.environment !== "native") continue;
			if (!entry.filePath) continue;
			// 活跃运行时的文件可能尚未落盘：pi 首条消息才创建 jsonl，预热激活后空闲
			// 进程甚至长期不写。有活绑定的会话「文件暂时不在」不是外部删除，跳过；
			// 运行终结后下一轮扫描按真实缺失清理（2026-10-05 事故：预热 attach 同秒
			// 扫描剔掉记录 → 闪回引导页、输入草稿丢失、发送另起新进程）。
			if (this.sessionLivenessProbe?.(entry.id)) continue;
			if (existsSync(entry.filePath)) continue;
			if (!findExistingAncestorDir(entry.filePath)) continue;
			externallyMissingIds.add(entry.id);
		}

		return this.enqueueMutation((entries) => {
			let changed = false;

			// 剔除磁盘已消失的 pi 原生条目（探测结果在入锁前算好）。
			if (externallyMissingIds.size > 0) {
				for (let index = entries.length - 1; index >= 0; index -= 1) {
					if (!externallyMissingIds.has(entries[index]!.id)) continue;
					entries.splice(index, 1);
					changed = true;
				}
			}

			// 清洗存量脏数据：pi-subagents artifactDir="session"（默认）的产物转储
			// 曾被旧版扫描误注册成 active 条目，导致每个子代理在侧栏「嵌套 + 顶层平铺」
			// 重复显示。扫描端已排除这些文件，但 mergeScanned 只增改不删，存量条目会
			// 永远留在 catalog 里；这里按同一路径规则移除并落盘（仅 pi 来源，导入会话不受影响）。
			for (let index = entries.length - 1; index >= 0; index -= 1) {
				const entry = entries[index]!;
				if (entry.source !== "pi" || !entry.filePath) continue;
				if (!isInSubagentArtifactsDir(entry.filePath)) continue;
				entries.splice(index, 1);
				changed = true;
			}

			// 清洗会话头校验失败的存量条目：本轮补名读取判定为非有效会话的文件
			// （transcript 等无 type 头的产物，即便不在 subagent-artifacts 目录）。
			// 仅 pi 来源；导入会话由各自导入器保证格式，不参与本校验。
			if (invalidOrigins.size > 0) {
				for (let index = entries.length - 1; index >= 0; index -= 1) {
					const entry = entries[index]!;
					if (entry.source !== "pi") continue;
					if (!entry.originKey || !invalidOrigins.has(entry.originKey)) continue;
					entries.splice(index, 1);
					changed = true;
				}
			}

			// 防御性过滤：扫描端漏网（subagent-artifacts）或会话头校验失败的产物不得注册新条目。
			const acceptedSummaries = summaries.filter((summary) => {
				if (summary.source === "pi" && isInSubagentArtifactsDir(summary.filePath)) return false;
				if (invalidOrigins.has(buildSummaryOriginKey(summary, context))) return false;
				return true;
			});

			const byOrigin = new Map(entries.filter((entry) => entry.originKey).map((entry) => [entry.originKey!, entry]));
			const summaryById = new Map<string, SessionSummary>();

			// Restore model/thinking from the session file when the catalog lacks them.
			// (Explicit user picks are already stored on the entry and are preserved.)
			function inheritSessionMeta(entry: SessionCatalogEntry, summary: SessionSummary) {
				if (!entry.model && summary.model) {
					entry.model = createSessionModelPreference(summary.model.provider, summary.model.modelId, undefined);
					changed = true;
				}
				if (!entry.thinkingLevel && summary.thinkingLevel) {
					entry.thinkingLevel = summary.thinkingLevel;
					changed = true;
				}
			}

			for (const summary of acceptedSummaries) {
				const originKey = buildSummaryOriginKey(summary, context);
				// 标题来源优先级：summary.name（readSummary 全量路径）先于读头补名。
				// nameFromSessionInfo=false 表示首条消息弱回退，所有权只算 fallback（#266）。
				const summaryTitle = catalogDisplayTitle(summary.name);
				const fetched = fetchedTitles.get(originKey);
				const fetchedTitle = catalogDisplayTitle(fetched?.name);
				const initialAuthoritative = summaryTitle ? summary.nameFromSessionInfo !== false : fetched?.fromSessionInfo === true;
				// 平铺子代理（tintinweb 形态）父关系回补：轻量扫描不带 parentSessionPath，
				// 标题回读时若探测到父（<agent>#<8hex> + parentSession header）则用拾取值；
				// 普通会话/用户 fork 不探测到该值，保持 summary/旧值原样。
				const fetchedParent = fetchedParents.get(originKey);
				// fork 标记回填：仅头部探测确认（parentSession + 非 tintinweb 形态）时置 true；
				// 有父关系（子代理折叠）的会话不标记——fork 与子代理是两种形态。
				const fetchedForkedFlag = fetchedForked.get(originKey);
				const importedSourceId = getImportedSessionSourceId(summary);
				let entry = byOrigin.get(originKey);
				if (!entry) {
					const now = summary.updatedAt || Date.now();
					const initialTitle = summaryTitle || fetchedTitle || scannedFileStemTitle(summary.filePath);
					const initialOrigin = scannedTitleOrigin(initialTitle, initialAuthoritative);
					entry = {
						id: randomUUID(),
						projectId,
						originKey,
						// listPathSummary 没有 name；readSummary 若仍带回时间戳文件名，也不能当标题。
						// 发现时读取到的名称是初始化值；纯占位名留给一次自动/补名领取，
						// 首条消息弱回退只算 fallback（等待扩展模型标题升级）。
						title: initialTitle,
						titleLocked: initialOrigin !== undefined,
						titleOrigin: initialOrigin,
						source: summary.source ?? "pi",
						environment: getSessionEnvironment(summary),
						filePath: summary.filePath,
						wslDistro: summary.wsl ? context.wslDistro : undefined,
						wslUser: summary.wsl ? context.wslUser : undefined,
						importedSourceId,
						status: "active",
						parentSessionPath: summary.parentSessionPath ?? fetchedParent,
						forked: (summary.parentSessionPath ?? fetchedParent) ? undefined : fetchedForkedFlag,
						createdAt: now,
						updatedAt: now,
					};
					entries.push(entry);
					byOrigin.set(originKey, entry);
					changed = true;
					if (options?.manualAssignment) entry.manualProjectAssignment = true;
				} else {
					// Catalog is the display-title authority. An explicitly unlocked entry is a
					// fresh provisional session, even if its UI label is "<project> agent";
					// it may absorb exactly one initial JSONL title before becoming owned.
					const canInitializeTitle = !isTitleLocked(entry);
					const initialTitle = summaryTitle || fetchedTitle;
					// fork/copy 现场（2026-10-08）：扫描在 pi 写入 session_info 名之前的几百毫秒
					// 窗口里先索引了新文件，从首条/尾部窗口兜底猜出一个标题并锁成 fallback；
					// 随后权威名落盘，但 canInitializeTitle 把它拒之门外 → 侧栏永久停在猜出
					// 的正文上。所有权语义上 fallback 是「内容派生的猜测」，权威 session_info
					// 名是「pi/用户写下的名字」——后者必须能升级前者（fallback → manual）。
					// auto/manual/legacy 终态不动（无命中时走 ?? 兑底保持原 origin）。
					const authoritativeUpgrade = initialAuthoritative && resolveTitleOrigin(entry) === "fallback";
					const canAbsorbTitle = canInitializeTitle || authoritativeUpgrade;
					// #266 存量自愈：legacy 条目读盘探测过一次。指纹命中（catalog 存的正是弱兜底名、
					// JSONL 另有权威名）才改写标题；探测过但没命中就消费掉这一次机会，落 manual 终态，
					// 避免每次扫描都为一个不可能自愈的条目读盘。读盘失败则保持 legacy 下次再试。
					const legacyProbe = fetchedLegacyProbes.get(originKey);
					const legacyRepair = legacyProbe ? repairedLegacyFallbackTitle(entry, summaryTitle && summary.nameFromSessionInfo === true ? { ...legacyProbe, authoritative: summaryTitle } : legacyProbe) : undefined;
					const nextTitle = legacyRepair || (canAbsorbTitle ? initialTitle : undefined) || catalogDisplayTitle(entry.title) || scannedFileStemTitle(summary.filePath);
					// rollout 文件名标题（历史导入兑底）不锁定：留一次被真实标题覆盖的机会；
					// 真实标题一旦落库即锁定，后续 pi /name 或 JSONL 变化不再反向改写。
					// 未锁定条目吸收的新标题按来源升级：权威 session_info → manual，首条消息弱回退 → fallback。
					const nextOrigin = legacyProbe ? "manual" : ((canAbsorbTitle && initialTitle ? scannedTitleOrigin(nextTitle, initialAuthoritative) : undefined) ?? resolveTitleOrigin(entry));
					const nextTitleLocked = nextOrigin !== undefined;
					// 父关系最终值：新探测值优先，缺失时保留旧值（轻量扫描恒缺省，不能清掉已持久化的父）。
					const nextParent = summary.parentSessionPath ?? fetchedParent ?? entry.parentSessionPath;
					// fork 标记同样只增补、不清空：未探测到（轻量扫描/普通会话）保留持久化值。
					const nextForked = nextParent ? entry.forked : fetchedForkedFlag || entry.forked;
					// 手动导入钉住的归属：别的项目扫描不得改回去（见 SessionCatalogEntry 注释）；
					// 用户再一次手动导入（manualAssignment）表示明确改主意，允许迁移到新项目。
					const nextProjectId = entry.manualProjectAssignment && !options?.manualAssignment && entry.projectId !== projectId ? entry.projectId : projectId;
					if (
						entry.projectId !== nextProjectId ||
						entry.filePath !== summary.filePath ||
						entry.title !== nextTitle ||
						entry.titleLocked !== nextTitleLocked ||
						entry.titleOrigin !== nextOrigin ||
						entry.source !== (summary.source ?? "pi") ||
						entry.environment !== getSessionEnvironment(summary) ||
						entry.wslDistro !== (summary.wsl ? context.wslDistro : undefined) ||
						entry.wslUser !== (summary.wsl ? context.wslUser : undefined) ||
						entry.importedSourceId !== importedSourceId ||
						entry.status !== "active" ||
						entry.parentSessionPath !== nextParent ||
						entry.forked !== nextForked ||
						entry.updatedAt !== summary.updatedAt
					) {
						entry.projectId = nextProjectId;
						entry.filePath = summary.filePath;
						entry.title = nextTitle;
						entry.titleLocked = nextTitleLocked;
						entry.titleOrigin = nextOrigin;
						entry.source = summary.source ?? "pi";
						entry.environment = getSessionEnvironment(summary);
						entry.wslDistro = summary.wsl ? context.wslDistro : undefined;
						entry.wslUser = summary.wsl ? context.wslUser : undefined;
						entry.importedSourceId = importedSourceId;
						entry.status = "active";
						// 子会话的父子关系可能随后续扫描才被识别（parent 文件出现/路径推断补全），
						// 变化必须计入 changed 才会落盘，否则重拉后仍以孤儿平铺。
						// 平铺子代理（tintinweb 形态）的父来自头部探测（fetchedParent，见上方）。
						// 注意：轻量扫描（listPathSummary）不读正文、parentSessionPath 恒为缺省，
						// 直接用缺省值覆盖会清掉上轮探测/持久化的父关系（重启后孤儿平铺）；
						// 故此处只增补、不清空——新值优先，其次保留旧值。
						entry.parentSessionPath = summary.parentSessionPath ?? fetchedParent ?? entry.parentSessionPath;
						entry.forked = nextForked;
						entry.updatedAt = summary.updatedAt;
						changed = true;
					}
					// 只有本次是手动导入才置位（自动扫描不得清除既有置位，否则归属又会被抢走）。
					if (options?.manualAssignment && !entry.manualProjectAssignment) {
						entry.manualProjectAssignment = true;
						changed = true;
					}
				}
				summaryById.set(entry.id, summary);
				inheritSessionMeta(entry, summary);
			}

			const records = entries.filter((entry) => entry.projectId === projectId).map((entry) => this.recordFromEntry(entry, summaryById.get(entry.id)));
			const idByPath = new Map<string, string>();
			for (const record of records) {
				if (!record.filePath) continue;
				idByPath.set(canonicalizeSessionPath(record.filePath, record.environment), record.id);
			}
			for (const record of records) {
				if (!record.parentSessionPath) continue;
				record.parentSessionId = idByPath.get(canonicalizeSessionPath(record.parentSessionPath, record.environment));
			}
			return {
				value: records.sort((left, right) => right.updatedAt - left.updatedAt),
				changed,
			};
		});
	}

	/** 对新文件、未确认 provisional 标题，或需要一次性回填旧子代理父关系的条目读取会话头。
	 * 已锁定 catalog 标题不会因为文件 mtime 变化而补读：PiDeck 已持久化显示名，
	 * 也不再关心 JSONL 中段或尾部追加的 session_info。标题读取仍顺带校验会话头、
	 * 补平铺子代理父关系和 fork 标记。 */
	private async collectScannedTitles(summaries: SessionSummary[], context: SessionCatalogContext): Promise<{ titles: Map<string, ScannedTitleFetch>; legacyProbes: Map<string, LegacyTitleProbe>; invalid: Set<string>; parents: Map<string, string>; forked: Map<string, boolean> }> {
		const titles = new Map<string, ScannedTitleFetch>();
		// 只收录**读取成功**的 legacy 探测：读不到（权限/锁定/WSL 抖动）时条目保持 legacy，下次扫描再试，
		// 否则一次瞬时失败就会把唯一的一次自愈机会消费掉。
		const legacyProbes = new Map<string, LegacyTitleProbe>();
		const invalid = new Set<string>();
		const parents = new Map<string, string>();
		const forked = new Map<string, boolean>();
		if (!this.fetchTitle) return { titles, legacyProbes, invalid, parents, forked };
		const byOrigin = new Map(this.entries.filter((entry) => entry.originKey).map((entry) => [entry.originKey!, entry]));
		const wanted: Array<{ originKey: string; filePath: string; includeTitle: boolean; legacyProbe?: boolean; lockedTitle?: string }> = [];
		for (const summary of summaries) {
			const originKey = buildSummaryOriginKey(summary, context);
			const existing = byOrigin.get(originKey);
			if (existing && isTitleLocked(existing)) {
				// Existing PiDeck-owned sessions do not need title freshness. The only
				// retained disk probe repairs a legacy flat subagent's missing parent link,
				// and requests header-only metadata rather than a full title scan.
				// 例外：legacy 存量条目（#266 可能被误锁）读一次标题窗口，用「权威名 + 弱兜底候选」做指纹判定；
				// 命中即修、不命中转终态，一次读取收口，之后与其他锁定条目一样不再读盘。
				const legacy = existing.source === "pi" && resolveTitleOrigin(existing) === "legacy";
				const tintinwebOrphan = existing.source === "pi" && !existing.parentSessionPath && /^[^#]+#[0-9a-f]{8}$/i.test(existing.title);
				if (legacy) wanted.push({ originKey, filePath: summary.filePath, includeTitle: true, legacyProbe: true, lockedTitle: existing.title });
				else if (tintinwebOrphan) wanted.push({ originKey, filePath: summary.filePath, includeTitle: false });
				continue;
			}
			// readSummary 全量路径已携带初始名称，无需再次读盘。
			if (catalogDisplayTitle(summary.name)) continue;
			// New files and explicitly unlocked provisional records need one exact title
			// read; every other locked record remains entirely out of this path.
			wanted.push({ originKey, filePath: summary.filePath, includeTitle: true });
		}
		if (wanted.length === 0) return { titles, legacyProbes, invalid, parents, forked };
		// 有界并行读头部；限制并发避免 WSL 环境一次拉起过多 wsl.exe。
		// 单个失败降级为无标题/不拒绝，不影响扫描结果。
		const CONCURRENCY = 8;
		let cursor = 0;
		const workers = Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, async () => {
			while (cursor < wanted.length) {
				const item = wanted[cursor++];
				const result = await this.fetchTitle!(item.filePath, { includeTitle: item.includeTitle }).catch(() => undefined);
				if (!result) continue;
				if (item.includeTitle && result.name) {
					// fromSessionInfo=false 是首条消息弱回退（#266）：所有权只能算 fallback，
					// 缺省（旧 fetcher/未标记）按权威名处理，保持既有行为。
					titles.set(item.originKey, { name: result.name, fromSessionInfo: result.nameFromSessionInfo !== false, fallbackName: result.fallbackName });
				}
				if (item.legacyProbe) {
					// 只有真读到 session_info 才算权威名：另一个弱兜底不能用来「修复」弱兜底。
					const authoritative = result.nameFromSessionInfo === true ? result.name : undefined;
					// #266：窗口兜底对不上目录标题时才多读一次有界前缀，取「文件内真首句」当第二指纹基准
					// （系统提示很大时窗口兜底会退化成尾部消息，只有真首句与当年写进 catalog 的标题一致）。
					const needsFirstUserText = Boolean(authoritative) && normalizeFingerprintTitle(result.fallbackName) !== normalizeFingerprintTitle(item.lockedTitle);
					// 深读失败（WSL 超时/文件被占）只降级回「窗口兜底比对」并消费掉这一次机会，不像读盘失败那样保持可重试：
					// 一条修不了的存量条目不值得每次扫描都再读 8MB。方向是安全的——最多保持原标题，不会写错。
					const firstUserText = needsFirstUserText
						? await this.fetchTitle!(item.filePath, { includeTitle: false, includeFirstUserText: true })
								.then((extra) => extra?.firstUserText)
								.catch(() => undefined)
						: undefined;
					legacyProbes.set(item.originKey, { authoritative, fallback: result.fallbackName, firstUserText });
				}
				// valid 显式为 false 才拒绝；缺省（读不到/未校验）保留原行为
				if (result.valid === false) invalid.add(item.originKey);
				// 平铺子代理（tintinweb 形态）回补父关系：来源只推断自 filename，
				// 不以 summary 的 source 过滤，避免引用文件与扫描来源不一致时漏补。
				if (result.parentSessionPath) parents.set(item.originKey, result.parentSessionPath);
				// pi fork/branch 会话标记（parentSession header + 非 tintinweb 形态）：只在探测到
				// 才写 true，不写 false——普通会话/子代理不该反向清掉已持久化的标记。
				if (result.forked === true) forked.set(item.originKey, true);
			}
		});
		await Promise.all(workers);
		return { titles, legacyProbes, invalid, parents, forked };
	}

	private recordFromEntry(entry: SessionCatalogEntry, summary?: SessionSummary): SessionRecord {
		return {
			id: entry.id,
			projectId: entry.projectId,
			title: catalogDisplayTitle(entry.title) || "Untitled",
			noSession: entry.noSession,
			source: summary?.source ?? entry.source,
			environment: summary ? getSessionEnvironment(summary) : entry.environment,
			backend: entry.backend,
			filePath: summary?.filePath ?? entry.filePath,
			wslDistro: entry.wslDistro,
			wslUser: entry.wslUser,
			importedSourceId: summary ? getImportedSessionSourceId(summary) : entry.importedSourceId,
			parentSessionPath: summary?.parentSessionPath ?? entry.parentSessionPath,
			forked: entry.forked,
			supersededBy: entry.supersededBy,
			projectPath: summary?.projectPath,
			preview: summary?.preview ?? "",
			messageCount: summary?.messageCount ?? 0,
			status: entry.status,
			model: entry.model ? { ...entry.model } : undefined,
			thinkingLevel: entry.thinkingLevel,
			proxy: entry.proxy ? { ...entry.proxy } : undefined,
			createdAt: entry.createdAt,
			updatedAt: summary?.updatedAt ?? entry.updatedAt,
			wsl: summary?.wsl,
			codexSessionId: summary?.codexSessionId,
			codexThreadSource: summary?.codexThreadSource,
			codexParentThreadId: summary?.codexParentThreadId,
			codexAgentRole: summary?.codexAgentRole,
			codexAgentNickname: summary?.codexAgentNickname,
		};
	}

	private originKeyForEntry(entry: SessionCatalogEntry): string | undefined {
		if (!entry.filePath) return undefined;
		return buildSessionOriginKey({
			source: entry.source,
			environment: entry.environment,
			filePath: entry.filePath,
			wslDistro: entry.wslDistro ?? this.identityContext.wslDistro,
			wslUser: entry.wslUser ?? this.identityContext.wslUser,
			importedSourceId: entry.importedSourceId,
		});
	}

	/**
	 * 把条目中的相对 filePath 修正为绝对路径（通过注入的 resolver）。
	 * 返回新数组表示有变更；未注入 resolver 或无需修正时返回 undefined。
	 */
	private repairRelativeFilePaths(entries: SessionCatalogEntry[]): SessionCatalogEntry[] | undefined {
		const resolve = this.resolveFilePath;
		if (!resolve) return undefined;
		let changed = false;
		const next = entries.map((entry) => {
			if (!entry.filePath) return entry;
			const resolved = resolve(entry.projectId, entry.filePath, entry.environment);
			if (!resolved || resolved === entry.filePath) return entry;
			changed = true;
			const repaired = { ...entry, filePath: resolved };
			// originKey 必须无条件重算：早期 catalog 不落 originKey（旧字段缺失），
			// 只在「已有 originKey」时重算会让这类存量条目修完路径仍带 undefined key，
			// mergeScanned 无法按 origin 折叠 → 同一文件双记录 + 标题所有权被扫描
			// 重新初始化为弱兑底（2026-10-08 fork/copy 现场的重复/坏标题根源之一）。
			repaired.originKey = this.originKeyForEntry(repaired);
			return repaired;
		});
		return changed ? next : undefined;
	}

	private requireEntry(entries: SessionCatalogEntry[], id: string): SessionCatalogEntry {
		const entry = entries.find((candidate) => candidate.id === id);
		if (!entry) throw new Error(`Session not found: ${id}`);
		return entry;
	}

	/**
	 * 标记重发/编辑 fork 化替换：origin 会话被 fork 出的子会话接替（supersededBy=子会话 id）。
	 * 只打标记不删文件——旧 JSONL 留在磁盘可恢复，会话列表按该标记过滤（sessionsCatalogList）。
	 * 幂等：同值重复标记不产生写入；id 未知（fork 成功但记录已被并发删除的竞态）静默返回 undefined。
	 */
	async markSuperseded(id: string, supersededBy: string): Promise<SessionCatalogEntry | undefined> {
		this.assertLoaded();
		return this.enqueueMutation((entries) => {
			const entry = entries.find((candidate) => candidate.id === id);
			if (!entry) return { value: undefined, changed: false };
			if (entry.supersededBy === supersededBy) {
				return { value: cloneEntry(entry), changed: false };
			}
			entry.supersededBy = supersededBy;
			entry.updatedAt = Date.now();
			return { value: cloneEntry(entry), changed: true };
		});
	}

	private assertLoaded(): void {
		if (!this.loaded) throw new Error("SessionCatalog.load() must complete before use");
	}

	private enqueueMutation<T>(mutate: (entries: SessionCatalogEntry[]) => { value: T; changed: boolean }): Promise<T> {
		const operation = this.writeQueue
			.catch(() => undefined)
			.then(async () => {
				const nextEntries = this.entries.map(cloneEntry);
				const result = mutate(nextEntries);
				if (result.changed) {
					await this.writeSnapshot(nextEntries);
					this.entries = nextEntries;
				}
				return result.value;
			});
		this.writeQueue = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	private backupFilePath(): string {
		return `${this.filePath}.bak`;
	}

	private async readCatalogFile(filePath: string): Promise<{
		entries: SessionCatalogEntry[];
	}> {
		const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<SessionCatalogFile>;
		if (!Array.isArray(parsed.sessions)) {
			throw new Error(`Invalid Session catalog: ${filePath}`);
		}
		const entries = parsed.sessions.filter((entry): entry is SessionCatalogEntry => typeof entry?.id === "string" && typeof entry.projectId === "string" && typeof entry.title === "string" && (entry.environment === "native" || entry.environment === "wsl") && (entry.status === "draft" || entry.status === "active"));
		if (entries.length !== parsed.sessions.length) {
			throw new Error(`Session catalog contains invalid records: ${filePath}`);
		}
		return {
			entries: entries.filter((entry) => (entry.backend === undefined || entry.backend === "pi") && entry.noSession !== true).map(cloneEntry),
		};
	}

	private async writeSnapshot(entries: SessionCatalogEntry[]): Promise<void> {
		const snapshot: SessionCatalogFile = {
			version: 1,
			sessions: entries.map(cloneEntry),
		};
		await mkdir(dirname(this.filePath), { recursive: true });
		const nonce = randomUUID();
		const tempPath = `${this.filePath}.${nonce}.tmp`;
		const backupPath = this.backupFilePath();
		const backupTempPath = `${backupPath}.${nonce}.tmp`;
		try {
			const handle = await open(tempPath, "w");
			try {
				await handle.writeFile(JSON.stringify(snapshot, null, 2), "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}

			if (!this.skipNextBackup) {
				try {
					await copyFile(this.filePath, backupTempPath);
					await renameWithRetry(backupTempPath, backupPath);
				} catch (error) {
					await unlink(backupTempPath).catch(() => undefined);
					if (isMissingFileError(error)) {
						// 首次写入：主文件还不存在，没有可备份的内容，属正常情况
					} else {
						// 备份轮换失败不能阻断 catalog 写入（新建会话等操作会因此失败）：
						// .bak 只是崩溃恢复的冗余副本，主文件仍是原子替换，旧内容在失败时原样保留。
						void getAppLogger()?.warn("session-catalog", "Backup rotation failed, continuing without backup", {
							cause: error instanceof Error ? error.message : String(error),
						});
					}
				}
			}
			await renameWithRetry(tempPath, this.filePath);
			this.skipNextBackup = false;
		} finally {
			await unlink(tempPath).catch(() => undefined);
			await unlink(backupTempPath).catch(() => undefined);
		}
	}
}

export function didSessionPreferencesChange(entry: SessionCatalogEntry, patch: Pick<SessionCatalogEntry, "model" | "thinkingLevel">): boolean {
	return !equalModel(entry.model, patch.model) || entry.thinkingLevel !== patch.thinkingLevel;
}
