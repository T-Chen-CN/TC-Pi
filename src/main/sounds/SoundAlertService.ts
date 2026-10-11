import { ipcChannels } from "../../shared/ipc";
import type { SoundAlertKind } from "../../shared/types/soundAlert";
import type { AgentManager } from "../pi/AgentManager";
import type { SettingsStore } from "../settings/SettingsStore";
import { createSoundAlertTrackerState, resolveSoundPlayback, trackAgentSettled, trackAgentTabs, trackUiRequest, type SoundAlertTrackerState } from "./soundAlertTracker";

export type SoundAlertServiceDeps = {
	agentManager: AgentManager;
	settingsStore: SettingsStore;
	/** 主窗口获取器：窗口已销毁/未创建时丢弃推送（无窗口可响）。 */
	getMainWindow: () => { webContents: { send(channel: string, payload: unknown): void } } | null;
	/** 日志回调（appLogger.info 的窄接口），便于测试注入。 */
	log?: (domain: string, message: string, details?: Record<string, unknown>) => void;
};

export class SoundAlertService {
	private state: SoundAlertTrackerState = createSoundAlertTrackerState();
	private offSettled: (() => void) | null = null;
	private offState: (() => void) | null = null;
	private offOutput: (() => void) | null = null;
	private attached = false;

	constructor(private readonly deps: SoundAlertServiceDeps) {}

	/** 挂载 AgentManager 监听；重复调用安全（先卸载旧的）。 */
	attach(): void {
		if (this.attached) return;
		this.attached = true;
		this.offSettled = this.deps.agentManager.onAgentSettled((info) => {
			const event = trackAgentSettled(this.state, info.agentId, info.title, Date.now());
			if (event) this.maybePlay(event.kind, event.title);
		});
		this.offState = this.deps.agentManager.addStateListener((tabs) => {
			const events = trackAgentTabs(this.state, tabs, Date.now());
			for (const event of events) this.maybePlay(event.kind, event.title);
		});
		// waiting：复用主进程输出订阅，只消费已规范化的 agents:ui-request
		this.offOutput = this.deps.agentManager.onOutput((channel, payload) => {
			if (channel !== ipcChannels.agentsUiRequest || !payload || typeof payload !== "object") return;
			const event = trackUiRequest(this.state, payload as Parameters<typeof trackUiRequest>[1], Date.now());
			if (event) this.maybePlay(event.kind, event.title);
		});
	}

	/** 卸载全部监听（退出清理路径）。 */
	detach(): void {
		if (!this.attached) return;
		this.attached = false;
		this.offSettled?.();
		this.offSettled = null;
		this.offState?.();
		this.offState = null;
		this.offOutput?.();
		this.offOutput = null;
		this.state = createSoundAlertTrackerState();
	}

	/**
	 * 设置门控 + 推送：门控/音效回落/音量钳制全部在 resolveSoundPlayback（纯函数，可单测）；
	 * 这里只负责取设置 + 发窗口，任何异常都不能影响主链路（提醒是尽力而为）。
	 */
	private maybePlay(kind: SoundAlertKind, title: string): void {
		try {
			const settings = this.deps.settingsStore.get().soundAlert;
			const playback = resolveSoundPlayback(kind, title, settings);
			if (!playback) return;
			const window = this.deps.getMainWindow();
			if (!window) return;
			window.webContents.send(ipcChannels.soundsPlay, playback);
			this.deps.log?.("sound-alert", "Play sound alert", { kind, title });
		} catch (error) {
			this.deps.log?.("sound-alert", "Sound alert failed", { kind, error: String(error) });
		}
	}
}
