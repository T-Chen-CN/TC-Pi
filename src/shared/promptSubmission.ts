import type { ComposerAgentMode } from "./types";

export const PI_DECK_PLAN_MODE_MARKER = "__PI_DECK_PLAN_MODE__";
export const PI_DECK_GOAL_MODE_MARKER = "__PI_DECK_GOAL_MODE__";

export type ComposerPromptSubmission = {
	/** 用户可见消息不含内部模式标记。 */
	message: string;
	/** 仅发给 Pi Agent/扩展的消息。 */
	agentMessage?: string;
};
/** 统一构造 Pi 模式标记：桌面、Web 和自动化发送使用同一份协议。 */
export function buildComposerPromptSubmission(message: string, mode: ComposerAgentMode): ComposerPromptSubmission {
	const trimmed = message.trim();
	// 斜线命令原样发送，让 pi 解析执行——plan/goal 模式下也能用 /plan off、/goal pause。
	// 否则隐藏标记前缀会把命令变成普通消息发给 LLM。
	if (trimmed.startsWith("/")) return { message };

	if (mode === "plan") {
		const visibleInstruction = trimmed || "请根据已附加的图片或上下文先制定实施计划。";
		return {
			message,
			agentMessage: [PI_DECK_PLAN_MODE_MARKER, visibleInstruction, "", "请先只做只读分析，不要修改文件。最后必须输出以 `Plan:` 开头的编号计划，格式如下：", "Plan:", "1. 第一步", "2. 第二步"].join("\n"),
		};
	}

	if (mode === "goal") {
		const visibleInstruction = trimmed || "请继续当前目标。";
		return {
			message,
			agentMessage: [PI_DECK_GOAL_MODE_MARKER, visibleInstruction].join("\n"),
		};
	}

	return { message };
}
