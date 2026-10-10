/**
 * Store IPC handlers: prompts + skills + xue + extensions.
 * Phase 3.5: extracted from src/main/index.ts registerIpc().
 */

import { ipcMain } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type { CreatePiPromptTemplateInput, PiPromptTemplateSummary, PromptStoreItem, PromptStoreRawItem, PromptStoreSearchResponse, PromptStoreSearchResult } from "../../shared/types";
import type { AppLogger } from "../logging/AppLogger";
import type { PromptManager } from "../prompts/PromptManager";
import type { SkillManager } from "../skills/SkillManager";
import type { ExtensionManager } from "../extensions/ExtensionManager";
import type { ProjectResourceManager } from "../projects/ProjectResourceManager";
import type { ConfigManager } from "../config/ConfigManager";

export type StoreIpcDeps = {
	promptManager: PromptManager;
	skillManager: SkillManager;
	extensionManager: ExtensionManager;
	projectResourceManager: ProjectResourceManager;
	/** Project trust is checked before any store write; optional keeps isolated IPC tests lightweight. */
	configManager?: ConfigManager;
	projectTrustPath?: (projectRoot: string, projectId: string) => string;
	appLogger: AppLogger;
	mainCopy: (key: string, params?: Record<string, string | number>) => string;
};

export function registerStoreIpc({ promptManager, skillManager, extensionManager, projectResourceManager, configManager, projectTrustPath, appLogger, mainCopy }: StoreIpcDeps): void {
	const requireText = (value: unknown, label: string, maxLength = 4096): string => {
		if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
			throw new Error(`Invalid ${label}.`);
		}
		return value;
	};
	const requireString = (value: unknown, label: string, maxLength: number): string => {
		if (typeof value !== "string" || value.length > maxLength) {
			throw new Error(`Invalid ${label}.`);
		}
		return value;
	};
	const promptInput = (value: unknown): CreatePiPromptTemplateInput => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			throw new Error("Invalid prompt input.");
		}
		const name = "name" in value ? requireString(value.name, "prompt name", 256) : "";
		const description = "description" in value ? requireString(value.description, "prompt description", 4096) : "";
		return { name, description };
	};
	/**
	 * 商店导入载荷校验：渲染层不可信，null/非对象会在解构时变成裸 TypeError，
	 * content 无上界则可被超大字符串压垮写盘路径。字段上限与 promptsEdit 的
	 * requireString(content, 4MB) 同构，错误信息带字段名方便排查。
	 */
	const requireStoreItem = (value: unknown): { title: string; description: string; content: string } => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid store item.");
		const title = requireString((value as { title?: unknown }).title, "store item title", 512);
		const description = requireString((value as { description?: unknown }).description, "store item description", 4096);
		const content = requireString((value as { content?: unknown }).content, "store item content", 4 * 1024 * 1024);
		return { title, description, content };
	};
	const projectRoot = (projectId: unknown): string => {
		if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 256) {
			throw new Error("Invalid project id.");
		}
		return projectResourceManager.getProjectRoot(projectId.trim());
	};
	type ProjectInstallTarget = { id: string; root: string };
	const projectInstallTarget = async (projectId: unknown): Promise<ProjectInstallTarget | undefined> => {
		if (projectId === undefined || projectId === "") return undefined;
		const validProjectId = typeof projectId === "string" ? projectId.trim() : "";
		if (!validProjectId || validProjectId.length > 256) throw new Error("Invalid project id.");
		const root = await projectResourceManager.resolveProjectRoot(validProjectId);
		if (!configManager) throw new Error(mainCopy("mainProjectResource.projectNotTrusted"));
		const trustPath = projectTrustPath?.(root, validProjectId) ?? root;
		const trusted = await configManager.getProjectTrustDecision(trustPath);
		if (trusted !== true) throw new Error(mainCopy("mainProjectResource.projectNotTrusted"));
		return { id: validProjectId, root };
	};

	// ── Prompt Templates ──
	ipcMain.handle(ipcChannels.promptsList, () => promptManager.list());
	// 编辑内置模板时先创建用户副本（fork）再写入内容，渲染层编辑流程依赖此通道。
	ipcMain.handle(ipcChannels.promptsCreate, async (_event, input: unknown) => {
		const validInput = promptInput(input);
		const result = await promptManager.create(validInput);
		void appLogger.info("prompt", "Prompt template created", { name: validInput.name });
		return result;
	});
	ipcMain.handle(ipcChannels.promptsDelete, async (_event, filePath: unknown) => {
		const validPath = requireText(filePath, "prompt path", 32_768);
		await promptManager.delete(validPath);
		void appLogger.info("prompt", "Prompt template deleted", { filePath: validPath });
	});
	ipcMain.handle(ipcChannels.promptsOpenFolder, () => promptManager.openFolder());
	ipcMain.handle(ipcChannels.promptsEdit, async (_event, filePath: unknown, content?: unknown) => {
		const validPath = requireText(filePath, "prompt path", 32_768);
		if (content !== undefined) {
			const validContent = requireString(content, "prompt content", 4 * 1024 * 1024);
			await promptManager.writeContent(validPath, validContent);
			return;
		}
		return promptManager.readContent(validPath);
	});
	ipcMain.handle(ipcChannels.promptsListByProject, async (_event, projectId: unknown) => {
		const root = projectRoot(projectId);
		return promptManager.listByProject(root, (projectId as string).trim());
	});
	ipcMain.handle(ipcChannels.promptsCreateInProject, async (_event, projectId: unknown, input: unknown) => {
		const validInput = promptInput(input);
		const root = projectRoot(projectId);
		const result = await promptManager.createInProject(root, validInput);
		void appLogger.info("prompt", "Project prompt template created", {
			projectId,
			name: validInput.name,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.promptsDeleteInProject, async (_event, projectId: unknown, name: unknown) => {
		const validName = requireText(name, "project prompt name", 256);
		const root = projectRoot(projectId);
		await promptManager.deleteFromProject(root, validName);
		void appLogger.info("prompt", "Project prompt template deleted", { projectId, name: validName });
	});
	ipcMain.handle(ipcChannels.promptsRename, async (_event, oldName: unknown, newName: unknown) => {
		const validOldName = requireText(oldName, "old prompt name", 256);
		const validNewName = requireText(newName, "new prompt name", 256);
		const result = await promptManager.rename(validOldName, validNewName);
		void appLogger.info("prompt", "Prompt template renamed", {
			oldName: validOldName,
			newName: validNewName,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.promptsRenameInProject, async (_event, projectId: unknown, oldName: unknown, newName: unknown) => {
		const validOldName = requireText(oldName, "old project prompt name", 256);
		const validNewName = requireText(newName, "new project prompt name", 256);
		const result = await promptManager.renameInProject(projectRoot(projectId), validOldName, validNewName);
		void appLogger.info("prompt", "Project prompt template renamed", {
			projectId,
			oldName: validOldName,
			newName: validNewName,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.promptsToggle, async (_event, filePath: unknown, enabled: unknown) => {
		const validPath = requireText(filePath, "prompt path", 32_768);
		if (typeof enabled !== "boolean") throw new Error("Invalid prompt toggle input.");
		const result = await promptManager.toggle(validPath, enabled);
		void appLogger.info("prompt", "Prompt template toggled", { filePath: validPath, enabled });
		return result;
	});
	ipcMain.handle(ipcChannels.promptsToggleInProject, async (_event, projectId: unknown, name: unknown, enabled: unknown) => {
		const validName = requireText(name, "project prompt name", 256);
		if (typeof enabled !== "boolean") {
			throw new Error("Invalid project prompt toggle input.");
		}
		const result = await promptManager.toggleInProject(projectRoot(projectId), validName, enabled, (projectId as string).trim());
		void appLogger.info("prompt", "Project prompt template toggled", {
			projectId,
			name: validName,
			enabled,
		});
		return result;
	});

	// ── Prompt Store (prompts.chat) ──────────────────────────────────────
	const PROMPT_STORE_BASE = "https://prompts.chat/api";

	/** 将 prompts.chat 原始 prompt 条目扁平化为 UI 消费的格式 */
	function flattenPromptItem(raw: PromptStoreRawItem): PromptStoreItem {
		return {
			id: raw.id,
			title: raw.title,
			description: raw.description,
			content: raw.content,
			type: raw.type,
			author: raw.author?.name ?? "",
			category: raw.category?.name ?? "",
			tags: raw.tags?.map((t) => t.tag?.name).filter(Boolean) ?? [],
			votes: raw.voteCount ?? 0,
			createdAt: raw.createdAt,
		};
	}

	/** 将 prompts.chat 的命名变量转换为 pi 的位置参数 */
	function convertStoreVarsToPiVars(content: string): { converted: string; argumentHint: string; varCount: number } {
		const varMap = new Map<string, { index: number; hasDefault: boolean; defaultVal?: string }>();
		let nextIndex = 1;
		const scanRegex = /\$\{([a-zA-Z_]\w*)(?::(.*?))?\}/g;
		let scanMatch: RegExpExecArray | null;
		while ((scanMatch = scanRegex.exec(content)) !== null) {
			const varName = scanMatch[1];
			if (!varMap.has(varName)) {
				varMap.set(varName, {
					index: nextIndex++,
					hasDefault: scanMatch[2] !== undefined,
					defaultVal: scanMatch[2],
				});
			}
		}
		if (varMap.size === 0) {
			return { converted: content, argumentHint: "", varCount: 0 };
		}
		let converted = content.replace(/\$\{([a-zA-Z_]\w*)(?::(.*?))?\}/g, (_match, varName: string, defaultVal?: string) => {
			const info = varMap.get(varName)!;
			if (defaultVal !== undefined) {
				return `\${${info.index}:-${defaultVal}}`;
			}
			return `$${info.index}`;
		});
		const hints: string[] = [];
		for (let i = 1; i < nextIndex; i++) {
			const entry = Array.from(varMap.entries()).find(([, v]) => v.index === i);
			if (!entry) continue;
			const [varName, info] = entry;
			if (info.hasDefault) {
				hints.push(`[${varName}:${info.defaultVal}]`);
			} else {
				hints.push(`<${varName}>`);
			}
		}
		const argumentHint = hints.length > 0 ? hints.join(" ") : "";
		return { converted, argumentHint, varCount: varMap.size };
	}

	// ── Extensions ──────────────────────────────
	ipcMain.handle(ipcChannels.extensionsList, (_event, forceRefresh?: boolean) => extensionManager.list(Boolean(forceRefresh)));
	ipcMain.handle(ipcChannels.extensionsRemoveBuiltIn, async (_event, source: string) => {
		try {
			await extensionManager.removeBuiltIn(source);
			void appLogger.info("extension", "Built-in extension removed", { source });
		} catch (error) {
			void appLogger.error("extension", "Built-in extension remove failed", {
				source,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	});
	ipcMain.handle(ipcChannels.extensionsRestoreBuiltIn, async (_event, source: string) => {
		await extensionManager.restoreBuiltIn(source);
		void appLogger.info("extension", "Built-in extension restored", { source });
	});
	ipcMain.handle(ipcChannels.extensionsUninstall, async (_event, source: string, scope?: "user" | "project" | "unknown") => {
		try {
			const result = await extensionManager.uninstall(source, scope);
			void appLogger.info("extension", "Extension uninstalled", { source, scope });
			return result;
		} catch (error) {
			void appLogger.error("extension", "Extension uninstall failed", {
				source,
				scope,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	});
	ipcMain.handle(ipcChannels.extensionsInstall, async (_event, source: string, projectId?: unknown) => {
		const target = await projectInstallTarget(projectId);
		const result = await extensionManager.install(source, target ? { projectRoot: target.root } : undefined);
		void appLogger.info("extension", "Extension installed", {
			source,
			scope: target ? "project" : "global",
			projectId: target?.id,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.extensionsToggle, async (_event, source: string, enabled: boolean, scope?: "user" | "project" | "unknown", path?: unknown, projectId?: unknown) => {
		// 原生过滤规则：本地文件扩展要精确路径，项目作用域要 projectId（来自渲染层，主进程校验）。
		const extensionPath = typeof path === "string" && path.length <= 32_768 ? path : undefined;
		const resolvedProjectId = typeof projectId === "string" && projectId.trim() && projectId.length <= 256 ? projectId.trim() : undefined;
		if (scope === "project" && !resolvedProjectId) throw new Error("Project scope requires a project id.");
		// 内置扩展与原生过滤规则的分流收口在 ExtensionManager.toggleFromUi：与 Web 工作区路由共用同一入口，
		// 避免两处各写一套「pi-deck-* 前缀 ≠ 内置身份」的白名单判定（issue #321 教训）。
		await extensionManager.toggleFromUi(source, enabled, scope, extensionPath, resolvedProjectId);
		void appLogger.info("extension", "Extension toggled", { source, enabled, scope, projectId });
	});
	ipcMain.handle(ipcChannels.extensionsUpdate, async () => {
		const result = await extensionManager.updateExtensions();
		void appLogger.info("extension", "Extensions update command completed", { updated: result.updated, bytes: result.output.length });
		return result;
	});
	ipcMain.handle(ipcChannels.extensionsUpdateOne, async (_event, source: string) => {
		const result = await extensionManager.updateExtension(source);
		void appLogger.info("extension", "Extension update-one command completed", { source, updated: result.updated, bytes: result.output.length });
		return result;
	});
}
