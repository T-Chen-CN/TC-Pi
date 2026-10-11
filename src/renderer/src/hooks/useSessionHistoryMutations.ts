import { useCallback, useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import type { ChatMessage, ImageContent, SessionRuntimeTarget } from "../../../shared/types";
import { desktopApi as api } from "../desktopApi";
import { t } from "../i18n";
import { cacheSessionMessagesAtom, setSessionHistoryMutationOverlayAtom, setSessionMessageLoadStateAtom, type SessionHistoryMutationOverlayKind } from "../atoms/session-atoms";
import { requireSessionCommand, sessionCommandFailureToast } from "../utils/sessionCommands";
import { setSessionQuotesAtom } from "../atoms/composer-atoms";
import { extractQuoteTokens, pruneUnreferencedQuotes, rehydrateDraftFromMessage } from "../components/session/composer/quoteChip";
import { resolveHistoryMutationPath, shouldShowResendRollbackHint } from "../utils/sessionHistoryMutationPolicy";
import type { NoticeKind } from "../utils/notice";

import { useSessionMessageImageRemoval } from "./useSessionMessageImageRemoval";

type ConfirmConfig = {
	title: string;
	message: string;
	onConfirm: () => void;
	danger?: boolean;
	confirmLabel?: string;
};

export interface SessionHistoryMutationsDeps {
	currentSessionId: string | undefined;
	getRuntimeTargetForSession: (sessionId: string | undefined) => SessionRuntimeTarget | undefined;
	getRuntimeTargetForAgent: (agentId: string | undefined) => SessionRuntimeTarget | undefined;
	/** 会话运行时是否 live（starting/idle/running）：决定改文件前是否需要先停 Agent。 */
	isSessionRuntimeLive: (sessionId: string) => boolean;
	showConfirm: (config: ConfirmConfig) => void;
	clearConfirm: () => void;
	showToast: (message: string, duration?: number, kind?: NoticeKind) => void;
	translateAgentErrorMessage: (message: string) => string;
	submitPromptSnapshot: (sessionId: string, message: string, images?: ImageContent[]) => Promise<boolean | "unknown">;
	openReplacedRuntimeSession: (projectId: string | undefined, targetSessionId: string | undefined) => Promise<void>;
	setPromptForAgent: (sessionId: string, text: string) => void;
	setCurrentSessionIdRef: (sessionId: string) => void;
	isAgentCurrentlyBusy: () => boolean;
	resolveProjectId: (sessionId: string) => string | undefined;
	/** 有会话文件才走 catalog JSONL；未落盘会话没有文件，仍用 runtime 命令。 */
	hasPersistedSessionFile: (sessionId: string) => boolean;
	/** 已删除后端的历史不允许再次发送或修改。 */
	isUnsupportedBackend?: (sessionId: string) => boolean;
	/** 目标消息是否是会话最后一条用户消息：决定 fork 后旧会话隐藏（替换）还是保留可见（分支）。 */
	isLastUserMessage?: (sessionId: string, message: ChatMessage) => boolean;
}

/**
 * pi 历史消息改写：编辑/重发走 fork 化重试（fork 到目标 entry → 子会话立即重发，旧分支
 * 完整保留在原文件，旧会话记录打 supersededBy 从列表隐藏）；删除仍走文件墓碑（无 runtime
 * backend 隐藏）。未落盘会话无文件：编辑/删除明确不支持，重发退化为重新提交。
 */
export function useSessionHistoryMutations(deps: SessionHistoryMutationsDeps) {
	const setOverlay = useSetAtom(setSessionHistoryMutationOverlayAtom);
	const cacheMessages = useSetAtom(cacheSessionMessagesAtom);
	const setLoadState = useSetAtom(setSessionMessageLoadStateAtom);
	const setQuotes = useSetAtom(setSessionQuotesAtom);
	const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
	const resendingIdsRef = useRef<Set<string>>(new Set());
	const overlaySessionRef = useRef<string | undefined>(undefined);
	const depsRef = useRef(deps);
	depsRef.current = deps;

	const showOverlay = useCallback(
		(sessionId: string, kind: SessionHistoryMutationOverlayKind) => {
			overlaySessionRef.current = sessionId;
			setOverlay({ sessionId, kind });
		},
		[setOverlay],
	);

	const hideOverlay = useCallback(
		(sessionId: string) => {
			if (overlaySessionRef.current === sessionId) overlaySessionRef.current = undefined;
			setOverlay({ sessionId, kind: null });
		},
		[setOverlay],
	);

	useEffect(() => {
		return () => {
			const sessionId = overlaySessionRef.current;
			if (sessionId) setOverlay({ sessionId, kind: null });
		};
	}, [setOverlay]);

	const failToast = useCallback((prefix: string, error: unknown) => {
		const latest = depsRef.current;
		latest.showToast(`${prefix}: ${sessionCommandFailureToast(error, latest.translateAgentErrorMessage)}`, 5000);
	}, []);

	const reloadTimelineFromDisk = useCallback(
		async (sessionId: string) => {
			showOverlay(sessionId, "reloading");
			setLoadState({ sessionId, state: { status: "loading" } });
			const page = await api.sessions.readRecordMessagePage(sessionId, undefined, 100);
			// force 写进去会把刚改过的会话显示成空白（编辑/删除/重发后立刻触发，最迷惑）。
			cacheMessages({
				sessionId,
				messages: page.messages,
				source: "disk",
				expectedRevision: 0,
				page: { total: page.total, nextBefore: page.nextBefore },
				force: true,
			});
			setLoadState({ sessionId, state: { status: "ready" } });
		},
		[cacheMessages, setLoadState, showOverlay],
	);

	/** live 运行时（starting/idle/running）才先停：error/closed 终态进程已死，先 stop 会误报（且产品上无需停）。 */
	const stopIfRunning = useCallback(
		async (sessionId: string) => {
			// 按 runtime status 而非 target 判定：主进程 requireStoppedForFileMutation 的 getTarget
			// 对 error/closed 有解绑副作用（返回 undefined），即终态不 BUSY、无需停。渲染层
			// getRuntimeTargetForSession 对 error/closed 仍保留 agentId（有 target），若用它判定
			// 会对已死进程误发 stop，并让删除文案误显「先停止 Agent」（见 after-crash e2e 回归）。
			if (!depsRef.current.isSessionRuntimeLive(sessionId)) return;
			const target = depsRef.current.getRuntimeTargetForSession(sessionId);
			if (!target) return;
			showOverlay(sessionId, "stopping");
			requireSessionCommand(await api.sessions.stopRuntime(target));
		},
		[showOverlay],
	);

	const confirmStopIfRunning = useCallback((sessionId: string, copy: { title: string; message: string; confirmLabel: string }, onConfirmed: () => Promise<void>) => {
		const latest = depsRef.current;
		// live 运行时（starting/idle/running）才需先停：error/closed 终态进程已死，直接改文件即可。
		// 主进程 getTarget 对 error/closed 有解绑副作用（返回 undefined）→ 不会 BUSY，无需停。
		const live = latest.isSessionRuntimeLive(sessionId);
		if (!live) {
			void onConfirmed();
			return;
		}
		latest.showConfirm({
			title: copy.title,
			message: copy.message,
			danger: true,
			confirmLabel: copy.confirmLabel,
			onConfirm: () => {
				latest.clearConfirm();
				void onConfirmed();
			},
		});
	}, []);

	const runFileMutation = useCallback(
		async (sessionId: string, work: () => Promise<void>) => {
			try {
				await stopIfRunning(sessionId);
				showOverlay(sessionId, "mutating");
				await work();
				await reloadTimelineFromDisk(sessionId);
			} finally {
				hideOverlay(sessionId);
			}
		},
		[hideOverlay, reloadTimelineFromDisk, showOverlay, stopIfRunning],
	);

	const removeMessageImage = useSessionMessageImageRemoval({ deps, runFileMutation, onFailure: failToast });

	/**
	 * 解析 fork 锚点 entryId。
	 * - pi：优先 meta.entryId，其次消息 id 的 "-history-" 后缀，最后 getForkMessages 文本回退匹配。
	 * target 由调用方传入（而非按 agentId 反查），避免「刚 activateRuntime 完、
	 * 渲染层 agentId→sessionId 映射尚未落库」的竞态导致回退匹配拿不到 target。
	 */
	const resolveForkEntryId = useCallback(async (message: ChatMessage, target?: SessionRuntimeTarget): Promise<string | undefined> => {
		if (typeof message.meta?.entryId === "string" && message.meta.entryId) {
			return message.meta.entryId;
		}
		const marker = "-history-";
		const historyIndex = message.id.lastIndexOf(marker);
		if (historyIndex >= 0) {
			const fromId = message.id.slice(historyIndex + marker.length).trim();
			if (fromId && fromId !== String(message.meta?._piDeckMsgSeq ?? "") && !/^\d+$/.test(fromId)) {
				return fromId;
			}
		}
		if (!target) return undefined;
		try {
			const wrapped = requireSessionCommand(await api.sessions.getRuntimeForkMessages(target));
			// IPC 形状是 SessionTargetedValue<Array>；兼容误拆一层的数组。
			const forkMessages = Array.isArray(wrapped) ? wrapped : wrapped.value;
			const targetText = message.text.trim();
			if (!targetText || !Array.isArray(forkMessages)) return undefined;
			for (let i = forkMessages.length - 1; i >= 0; i -= 1) {
				const item = forkMessages[i];
				if (item?.entryId && item.text?.trim() === targetText) return item.entryId;
			}
		} catch {
			// 交给上层 toast
		}
		return undefined;
	}, []);

	/**
	 * fork 化重试（重发/编辑迁移，zcode retryTurn 同构）：fork 到该消息 entry → 子会话
	 * 立即以原文（重发）或新文本（编辑）重发。旧分支完整留在原文件（不截断、不丢数据），
	 * 主进程把旧会话记录打 supersededBy 从列表隐藏（文件保留可恢复）。失败语义：fork 前
	 * /中任何一步失败会话保持原状，天然可重试；发送失败仅补状态 toast（旧历史无恙）。
	 */
	const runForkMutation = useCallback(
		async (kind: "resend" | "edit", message: ChatMessage, newText?: string) => {
			const latest = depsRef.current;
			const sessionId = latest.currentSessionId;
			if (!sessionId) return;
			let target = latest.getRuntimeTargetForSession(sessionId);
			if (!target) {
				// 冷会话：fork 走 runtime 命令，必须先有活进程（standby 池摊薄激活成本）
				showOverlay(sessionId, "activating");
				const activated = requireSessionCommand(await api.sessions.activateRuntime(sessionId));
				target = {
					sessionId,
					agentId: activated.agentId,
					runtimeGeneration: activated.runtimeGeneration,
				};
			}
			// 覆盖层文案按动作称呼（编辑中/重发中），“fork”是内部实现术语不暴露给用户；
			// 显式 fork 动作（forkFromUserMessage）仍用 forking 文案。
			showOverlay(sessionId, kind === "edit" ? "editing" : "resending");
			const entryId = await resolveForkEntryId(message, target);
			if (!entryId) {
				latest.showToast(t("app.forkMissingEntryId"), 4000);
				return;
			}
			const result = requireSessionCommand(
				await api.sessions.forkRuntimeSession(target, entryId, {
					mutationFork: true,
					// 分支模式：fork 锚点不是最后一条用户消息 → 旧会话还有独属它的后续轮次，
					// 不隐藏（带 (fork) 后缀两会话并存）；尾部替换才打 supersededBy。
					branchMode: latest.isLastUserMessage ? !latest.isLastUserMessage(sessionId, message) : false,
				}),
			);
			if (result.cancelled) {
				latest.showToast(t("app.forkCancelled"), 3500);
				return;
			}
			const projectId = latest.resolveProjectId(sessionId);
			const targetSessionId = result.targetSessionId;
			await latest.openReplacedRuntimeSession(projectId, targetSessionId);
			if (targetSessionId) latest.setCurrentSessionIdRef(targetSessionId);
			// 重发用 pi fork 返回的原文（与落盘一致），缺失时回退时间线文本；编辑用新文本。
			// 都不发引用重建（rehydrateDraftFromMessage）：fork 的上下文已在子会话前缀里，
			// 原样重发才是同一上下文。
			const promptText = kind === "edit" && newText !== undefined ? newText : typeof result.text === "string" && result.text.length > 0 ? result.text : (message.text ?? "");
			const delivered = await depsRef.current.submitPromptSnapshot(targetSessionId ?? sessionId, promptText, message.images);
			if (shouldShowResendRollbackHint(delivered)) {
				// 发送失败：旧分支无恙（无需回滚提示），但列表已切到子会话且没有新轮次，
				// 不说明会像「重发/编辑坏了」。
				latest.showToast(t(kind === "edit" ? "message.editSendFailedRolledBack" : "message.resendSendFailedRolledBack"), undefined, "warning");
			}
		},
		[resolveForkEntryId, showOverlay],
	);

	const editMessage = useCallback(
		async (message: ChatMessage, newText: string) => {
			const latest = depsRef.current;
			const sessionId = latest.currentSessionId;
			if (!sessionId) return;
			// 未落盘的首次发送 没有 JSONL：pi 的 editMessage 要求 sessionPath，缺失即报
			// “Session not persisted”，旧逻辑调必然失败的 runtime 命令。这里改为明确告知不支持。
			const path = resolveHistoryMutationPath({
				kind: "edit",
				live: latest.isSessionRuntimeLive(sessionId),
				persisted: latest.hasPersistedSessionFile(sessionId),
				unsupportedBackend: latest.isUnsupportedBackend?.(sessionId),
			});
			if (path.path === "unsupported-backend") {
				latest.showToast(t("app.legacyBackendReadOnly"), 4000);
				return;
			}
			if (path.path === "unsupported-unpersisted") {
				latest.showToast(t("message.unpersistedEditUnsupported"), 4000);
				return;
			}
			// fork 化编辑（pi）：确认停掉运行中的 turn 后 fork 到该消息 + 立即以新文本重发
			if (path.path === "fork-mutation") {
				confirmStopIfRunning(
					sessionId,
					{
						title: t("message.historyStopToEditTitle"),
						// 状态相关文案：running（含流式/工具执行）才说「会话正在运行」；
						// starting/idle（如刚重启完的空闲进程）只说操作本身，避免用户误以为还在处理中。
						message: latest.isAgentCurrentlyBusy() ? t("message.historyStopToEditBody") : t("message.historyStopToEditBodyIdle"),
						confirmLabel: t("app.stop"),
					},
					async () => {
						try {
							await runForkMutation("edit", message, newText);
						} catch (error) {
							failToast(t("message.editFailed"), error);
						} finally {
							// 与 resend 的 fork 分支对称：runForkMutation 内部 showOverlay 后有多个早退路径
							// （激活失败/entryId 缺失/cancelled/成功切会话），finally 里必须清 overlay，
							// 否则全遮罩永久挂死（overlay atom 无自动清除机制）。
							hideOverlay(sessionId);
						}
					},
				);
				return;
			}
		},
		[confirmStopIfRunning, failToast, runFileMutation, runForkMutation],
	);

	const deleteMessage = useCallback(
		(messageId: string, entryId?: string) => {
			const latest = depsRef.current;
			const sessionId = latest.currentSessionId;
			if (!sessionId) return;
			// 未落盘会话无文件可删：旧逻辑弹「删除后需要重新加载会话才能生效」的误导确认后调
			// deleteRuntimeMessage，必然报 “Session not persisted”。改为明确告知不支持。
			const path = resolveHistoryMutationPath({
				kind: "delete",
				unsupportedBackend: latest.isUnsupportedBackend?.(sessionId),
				live: latest.isSessionRuntimeLive(sessionId),
				persisted: latest.hasPersistedSessionFile(sessionId),
			});
			if (path.path === "unsupported-backend") {
				latest.showToast(t("app.legacyBackendReadOnly"), 4000);
				return;
			}
			if (path.path === "unsupported-unpersisted") {
				latest.showToast(t("message.unpersistedDeleteUnsupported"), 4000);
				return;
			}
			// kind 为 delete 时策略只会给出 unsupported-unpersisted 或 catalog，这里收窄类型
			if (path.path !== "catalog") return;
			// 文案与 stopIfRunning 同口径：按 runtime status 判定是否需先停。error/closed 终态进程
			// 已死（主进程 getTarget 对终态有解绑副作用，返回 undefined 不 BUSY），直接删除即可；
			// live（starting/idle/running）才提示「先停止 Agent」。
			const live = latest.isSessionRuntimeLive(sessionId);
			latest.showConfirm({
				title: t("message.deleteTitle"),
				message: live ? (latest.isAgentCurrentlyBusy() ? t("message.historyStopToDeleteBody") : t("message.historyStopToDeleteBodyIdle")) : t("message.deleteReloadPrompt"),
				danger: true,
				confirmLabel: live ? t("app.stop") : t("common.delete"),
				onConfirm: async () => {
					latest.clearConfirm();
					try {
						await runFileMutation(sessionId, async () => {
							requireSessionCommand(await api.sessions.deleteCatalogMessage(sessionId, messageId, entryId));
						});
					} catch (error) {
						failToast(t("message.deleteFailed"), error);
					}
				},
			});
		},
		[failToast, runFileMutation],
	);

	const resendUserMessage = useCallback(
		(message: ChatMessage) => {
			const latest = depsRef.current;
			const sessionId = latest.currentSessionId;
			if (!sessionId) return;
			if (resendingIdsRef.current.has(message.id)) return;
			const path = resolveHistoryMutationPath({
				kind: "resend",
				live: latest.isSessionRuntimeLive(sessionId),
				persisted: latest.hasPersistedSessionFile(sessionId),
				unsupportedBackend: latest.isUnsupportedBackend?.(sessionId),
			});
			// 未落盘消息重发：没有文件可截断旧轮次（prepareRuntimeResend 必然报 “Session not
			// persisted”），直接把原消息文本重新提交（submitPromptSnapshot 会自动激活
			// runtime）；旧轮次保留为历史，新轮次即新尝试。
			if (path.path === "unsupported-backend") {
				latest.showToast(t("app.legacyBackendReadOnly"), 4000);
				return;
			}
			if (path.path === "unpersisted-resend") {
				resendingIdsRef.current.add(message.id);
				setTimeout(() => resendingIdsRef.current.delete(message.id), 30_000);
				void latest
					.submitPromptSnapshot(sessionId, message.text ?? "", message.images)
					.catch((error) => failToast(t("message.resendFailed"), error))
					.finally(() => resendingIdsRef.current.delete(message.id));
				return;
			}
			// fork 化重发（pi）：确认停掉运行中的 turn 后 fork 到该消息 + 立即以原文重发。
			// 旧分支完整留在原文件，无需 prepare/truncate，发送失败也不丢历史。
			if (path.path === "fork-mutation") {
				const run = async () => {
					resendingIdsRef.current.add(message.id);
					setTimeout(() => resendingIdsRef.current.delete(message.id), 30_000);
					try {
						await runForkMutation("resend", message);
					} finally {
						resendingIdsRef.current.delete(message.id);
						hideOverlay(sessionId);
					}
				};
				confirmStopIfRunning(
					sessionId,
					{
						title: t("message.historyStopToResendTitle"),
						// 同上：仅 running 才报「会话正在运行」，空闲进程用无状态陈述。
						message: latest.isAgentCurrentlyBusy() ? t("message.historyStopToResendBody") : t("message.historyStopToResendBodyIdle"),
						confirmLabel: t("app.stop"),
					},
					run,
				);
				return;
			}
		},
		[confirmStopIfRunning, failToast, hideOverlay, runFileMutation, runForkMutation, showOverlay],
	);

	/**
	 * 在指定 entry 上 fork 新会话（显式 fork 动作的共享主体）。
	 * forkFromUserMessage 从时间线消息解析 entryId 后走这里；分支树面板直接持有
	 * entryId（节点即条目），省掉文本反查，共用同一套 overlay/草稿回填/会话切换语义。
	 */
	const forkAtEntry = useCallback(
		async (entryId: string, fallbackText: string, busyKey: string, images?: ImageContent[]) => {
			const latest = depsRef.current;
			const sessionId = latest.currentSessionId;
			if (!sessionId || latest.isAgentCurrentlyBusy()) return;
			if (forkingMessageId) return;
			setForkingMessageId(busyKey);
			try {
				let target = latest.getRuntimeTargetForSession(sessionId);
				if (!target) {
					showOverlay(sessionId, "activating");
					const activated = requireSessionCommand(await api.sessions.activateRuntime(sessionId));
					target = {
						sessionId,
						agentId: activated.agentId,
						runtimeGeneration: activated.runtimeGeneration,
					};
				}
				showOverlay(sessionId, "forking");
				const result = requireSessionCommand(await api.sessions.forkRuntimeSession(target, entryId));
				if (result.cancelled) {
					latest.showToast(t("app.forkCancelled"), 3500);
					return;
				}
				const rawPromptText = typeof result.text === "string" && result.text.length > 0 ? result.text : fallbackText;
				// 还原引用块：直接把 <quoted_context> 等 XML 塞回输入框会露出原文，
				// quote 重建快照 + #q token，session/skill/template 还原为 mention 文本。
				const { draft: promptText, quotes } = rehydrateDraftFromMessage(rawPromptText);
				const projectId = latest.resolveProjectId(sessionId);
				const targetSessionId = result.targetSessionId;
				await latest.openReplacedRuntimeSession(projectId, targetSessionId);
				const draftTarget = targetSessionId ?? sessionId;
				if (targetSessionId) latest.setCurrentSessionIdRef(targetSessionId);
				if (quotes.length > 0) {
					const referencedIds = new Set(extractQuoteTokens(promptText).map((occurrence) => occurrence.id));
					setQuotes({
						sessionId: draftTarget,
						value: (current) => ({
							...pruneUnreferencedQuotes(current, referencedIds),
							...Object.fromEntries(quotes.map((snippet) => [snippet.id, snippet])),
						}),
					});
				}
				latest.setPromptForAgent(draftTarget, promptText);
				window.dispatchEvent(new CustomEvent("user-message-edit", { detail: { text: promptText, images } }));
				latest.showToast(t("app.forkDone"), 3500);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				latest.showToast(t("app.forkFailed", { error: latest.translateAgentErrorMessage(msg) }), 5000);
			} finally {
				setForkingMessageId(null);
				hideOverlay(sessionId);
			}
		},
		[forkingMessageId, hideOverlay, showOverlay],
	);

	const forkFromUserMessage = useCallback(
		async (message: ChatMessage) => {
			const latest = depsRef.current;
			const sessionId = latest.currentSessionId;
			if (!sessionId || latest.isAgentCurrentlyBusy()) return;
			// entryId 解析可能需要活 runtime（文本反查兜底）：先取现成 target，没有再激活一次（仅解析用，
			// fork 本体与 overlay 生命周期交给 forkAtEntry）。
			let target: SessionRuntimeTarget | undefined = latest.getRuntimeTargetForSession(sessionId);
			if (!target) {
				showOverlay(sessionId, "activating");
				const activated = requireSessionCommand(await api.sessions.activateRuntime(sessionId));
				target = {
					sessionId,
					agentId: activated.agentId,
					runtimeGeneration: activated.runtimeGeneration,
				};
				hideOverlay(sessionId);
			}
			const entryId = await resolveForkEntryId(message, target);
			if (!entryId) {
				latest.showToast(t("app.forkMissingEntryId"), 4000);
				return;
			}
			await forkAtEntry(entryId, message.text, message.id, message.images);
		},
		[forkAtEntry, hideOverlay, resolveForkEntryId, showOverlay],
	);

	return {
		editMessage,
		deleteMessage,
		removeMessageImage,
		resendUserMessage,
		forkFromUserMessage,
		forkAtEntry,
		forkingMessageId,
	};
}
