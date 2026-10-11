import { resolveModelDisplayName } from "../../../shared/modelDisplayName";

/**
 * 后端拒绝运行中模型切换时的 fallback 展示推导。
 *
 * 支持 live selection 的后端直接更新 runtime，不会设置 pending；只有 busy/error
 * 路径才会把选择保留到后续空闲时重试。
 */

export type ModelPendingRef = {
	provider: string;
	modelId: string;
	modelName?: string;
};

export type ModelPending = {
	from: ModelPendingRef;
	to: ModelPendingRef;
};

export function formatModelRef(ref: Pick<ModelPendingRef, "provider" | "modelId" | "modelName">): string {
	const name = ref.modelName || ref.modelId || "-";
	return ref.provider ? `${ref.provider}/${name}` : name;
}

export type ModelDisplayResult = {
	from?: ModelPendingRef;
	to?: ModelPendingRef;
	pending: boolean;
};

export function computeModelDisplay(current: ModelPendingRef | undefined, pending: ModelPending | undefined): ModelDisplayResult {
	if (pending) {
		return { from: pending.from, to: pending.to, pending: true };
	}
	return { from: current, pending: false };
}

export type ComposerLiveModelSource = {
	provider?: string;
	modelId?: string;
	modelName?: string;
};

/**
 * 底栏/选择器当前模型只读取 PiDeck 的选择偏好。
 *
 * 已有会话取 `SessionRecord.model`，尚未创建会话的引导页取 `fallback`。运行时状态
 * 仍用于流式、工具和统计，但绝不能参与名称或当前选择的决策；这样 Agent 启动前后
 * 都展示同一份本地名称快照。
 */
export function resolveComposerLiveModel(input: { record?: { provider?: string; modelId?: string; modelName?: string }; fallback?: ComposerLiveModelSource }): ModelPendingRef {
	const source = input.record?.provider && input.record.modelId ? input.record : input.fallback;
	return {
		provider: source?.provider ?? "",
		modelId: source?.modelId ?? "",
		modelName: resolveModelDisplayName(source?.modelName, source?.modelId ?? ""),
	};
}

export function resolveGuideDisplayModel(input: {
	/** 引导页点选（已经过 isWelcomeModelLost 校验，失效时为 undefined）。两种后端各自传入对应存储的偏好。 */
	welcomeModel?: { provider: string; modelId: string; modelName?: string };

	defaultModel?: ComposerLiveModelSource;
}): ComposerLiveModelSource | undefined {
	return input.welcomeModel ?? input.defaultModel;
}
