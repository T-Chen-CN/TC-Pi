export type RespondingKind = "starting" | "executing" | "thinking" | "responding" | "compacting" | "waiting";

export function deriveRespondingKind(input: { isCompacting?: boolean; isStarting?: boolean; isExecutingTool?: boolean; liveTextStreaming?: boolean; liveThinkingStreaming?: boolean }): RespondingKind {
	if (input.isCompacting) return "compacting";
	if (input.isExecutingTool) return "executing";
	// 正文优先于思考：思考收尾与正文首字可能落在同一批更新里，正文是更外层、更靠后的
	// 阶段。先判正文可避免状态条从「撰写回复」退回「思考中」再跳回来。
	if (input.liveTextStreaming) return "responding";
	if (input.liveThinkingStreaming) return "thinking";
	if (input.isStarting) return "starting";
	return "waiting";
}
