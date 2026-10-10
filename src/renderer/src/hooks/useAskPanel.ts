import { useCallback } from "react";
import { useAtom, useAtomValue, useStore } from "jotai";
import { askPanelCreatingAtom, askPanelGenerationAtom, askPanelOpenAtom, askPanelOriginSessionIdAtom, askPanelSessionIdAtom } from "../atoms/ask-panel-atoms";
import { effectiveAgentBackendAtom } from "../atoms/app-ui-atoms";
import { upsertSessionAtom } from "../atoms/session-atoms";
import { sessionRuntimeBySessionIdAtomFamily } from "../atoms/session-selectors";
import { desktopApi } from "../desktopApi";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";

/**
 * 并行问询：
 * - sendToAsk(projectId, text, options)：创建/复用问询会话 → 等 runtime 就绪 → 投递消息 → 显示悬浮胶囊。
 *   问询会话有自己的历史与进程，与当前会话并行，不打断其输出。
 *   options.context：主会话上下文块（见 utils/askPanelContext.ts）。pi RPC 无跨进程上下文注入通道，
 *   改为经 SendPromptInput.agentMessage 传给模型（agentMessage 模型可见、UI 时间线不可见），
 *   因此首条 user 消息仍是用户原文，胶囊时间线不被上下文污染。
 *   options.originSessionId：发起并行问询的主会话 id，「带回主线（插入主会话 composer）」的落点。
 * - sendFollowUp(text)：向已就绪的问询会话继续追问（复用 sessionId，不重建 runtime）。
 * - close()：停止问询 runtime 并收起胶囊，保留历史，同时清空 origin 记录。
 */
export function useAskPanel() {
	const [isOpen, setOpen] = useAtom(askPanelOpenAtom);
	const [sessionId, setSessionId] = useAtom(askPanelSessionIdAtom);
	const [originSessionId, setOriginSessionId] = useAtom(askPanelOriginSessionIdAtom);
	const [creating, setCreating] = useAtom(askPanelCreatingAtom);
	// 读当前可用后端，与主会话创建策略保持一致。
	const defaultAgentBackend = useAtomValue(effectiveAgentBackendAtom);
	const store = useStore();

	// 创建或复用问询会话；失败返回 null 并 toast
	const ensureSession = useCallback(
		async (projectId: string): Promise<string | null> => {
			if (store.get(askPanelCreatingAtom)) return null;
			const existing = store.get(askPanelSessionIdAtom);
			if (existing) return existing;
			const generation = store.get(askPanelGenerationAtom);
			setCreating(true);
			try {
				const session = await desktopApi.sessions.createDraft({
					projectId,
					title: t("askPanel.sessionTitle"),
					// 默认后端跟随设置项（defaultAgentBackend，默认 pi），避免后端分裂（F2）
					backend: defaultAgentBackend,
				});
				// 普通会话保留历史，关闭问询只停止进程；与侧栏登记走同一原子入口。
				store.set(upsertSessionAtom, session);
				if (generation !== store.get(askPanelGenerationAtom)) return null;
				setSessionId(session.id);
				setOpen(true);
				const activation = await desktopApi.sessions.activateRuntime(session.id);
				if (generation !== store.get(askPanelGenerationAtom)) {
					// 关闭发生在启动中：回执持有真实代次，可安全停止这次迟到的进程。
					if (activation.ok && activation.value.agentId) await desktopApi.sessions.stopRuntime({ sessionId: session.id, agentId: activation.value.agentId, runtimeGeneration: activation.value.runtimeGeneration }).catch(() => undefined);
					return null;
				}
				if (!activation.ok) throw new Error(activation.error.code);
				return session.id;
			} catch (error) {
				if (generation !== store.get(askPanelGenerationAtom)) return null;
				setOpen(false);
				setSessionId(null);
				// 会话创建失败属异常，常驻提示直到用户手动关闭
				showNotice(error instanceof Error ? error.message : String(error), Number.POSITIVE_INFINITY, "error");
				return null;
			} finally {
				if (generation === store.get(askPanelGenerationAtom)) setCreating(false);
			}
		},
		[sessionId, setCreating, setOpen, setSessionId, store, defaultAgentBackend],
	);

	// 激活回执与渲染层 runtime 事件可错位，等待本会话投影就绪后再发送。
	// 注意 agent 就绪状态是 "idle"（"running" 表示正在处理消息），两者都算可发送。
	const waitRuntimeReady = useCallback(
		async (sessionId: string, timeoutMs = 15000): Promise<boolean> => {
			const deadline = Date.now() + timeoutMs;
			while (Date.now() < deadline) {
				if (store.get(askPanelSessionIdAtom) !== sessionId) return false;
				const runtime = store.get(sessionRuntimeBySessionIdAtomFamily(sessionId));
				if (runtime?.status === "running" || runtime?.status === "idle") return true;
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			return false;
		},
		[store],
	);

	// 向问询会话投递一条 prompt（共用首条/追问发送路径）
	const dispatchPrompt = useCallback(
		async (id: string, text: string, context?: string): Promise<boolean> => {
			const generation = store.get(askPanelGenerationAtom);
			const ready = await waitRuntimeReady(id);
			if (generation !== store.get(askPanelGenerationAtom)) return false;
			if (!ready) {
				// 启动超时提示含「请重试」指引，常驻直到用户手动关闭
				showNotice(t("askPanel.runtimeTimeout"), Number.POSITIVE_INFINITY, "error");
				return false;
			}
			try {
				// 上下文经 agentMessage 注入：模型看到「上下文块 + 用户问题」，
				// UI 乐观消息与权威回读都只显示 message（用户原文），不让上下文污染胶囊时间线
				await desktopApi.sessions.sendPrompt({
					sessionId: id,
					requestId: crypto.randomUUID(),
					message: text,
					...(context ? { agentMessage: `${context}\n\n${text}` } : {}),
				});
				return true;
			} catch (error) {
				// 发送失败属会话异常，常驻提示直到用户手动关闭
				showNotice(error instanceof Error ? error.message : String(error), Number.POSITIVE_INFINITY, "error");
				return false;
			}
		},
		[waitRuntimeReady, store],
	);

	const sendToAsk = useCallback(
		async (projectId: string, text: string, options?: { context?: string; originSessionId?: string }): Promise<boolean> => {
			const generation = store.get(askPanelGenerationAtom);
			const id = await ensureSession(projectId);
			if (!id || generation !== store.get(askPanelGenerationAtom)) return false;
			// 胶囊先显示：会话创建/启动需要数秒，先给用户即时反馈（创建中/等待响应状态）
			setOpen(true);
			setCreating(true);
			// 记录来源主会话，供「带回主线：插入主会话 composer」定位落点
			if (options?.originSessionId) setOriginSessionId(options.originSessionId);
			try {
				const ok = await dispatchPrompt(id, text, options?.context);
				return ok;
			} finally {
				if (generation === store.get(askPanelGenerationAtom)) setCreating(false);
			}
		},
		[dispatchPrompt, ensureSession, setCreating, setOpen, setOriginSessionId, store],
	);

	// 追问：复用已创建的问询会话继续对话（不再走 ensureSession/setCreating，避免胶囊闪烁）
	const sendFollowUp = useCallback(
		async (text: string): Promise<boolean> => {
			if (!sessionId) return false;
			const trimmed = text.trim();
			if (!trimmed) return false;
			return dispatchPrompt(sessionId, trimmed);
		},
		[dispatchPrompt, sessionId],
	);

	const close = useCallback(async () => {
		store.set(askPanelGenerationAtom, store.get(askPanelGenerationAtom) + 1);
		setOpen(false);
		setCreating(false);
		const closingId = store.get(askPanelSessionIdAtom);
		setSessionId(null);
		setOriginSessionId(null);
		if (!closingId) return;
		// 关闭面板只停止问询进程，普通会话历史仍可从工作区列表打开。
		const runtime = store.get(sessionRuntimeBySessionIdAtomFamily(closingId));
		if (runtime?.agentId) {
			try {
				await desktopApi.sessions.stopRuntime({
					sessionId: closingId,
					agentId: runtime.agentId,
					runtimeGeneration: runtime.runtimeGeneration,
				});
			} catch {
				// 停止失败不阻塞关闭（进程可能已退出）
			}
		}
	}, [setCreating, setOpen, setSessionId, setOriginSessionId, store]);

	return { isOpen, sessionId, originSessionId, creating, sendToAsk, sendFollowUp, close };
}
