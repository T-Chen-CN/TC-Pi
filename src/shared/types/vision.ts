/** Historical vision conversion events used by read-only message compatibility helpers. */
export type VisionEventItem = {
	/** 图片在本次转换中的序号（1 起，与消息文本「图片 #N」同源） */
	index: number;
	/** 图片内容 sha256 前 24 位：渲染层按此把事件匹配到发送中的实时消息（跨会话稳定） */
	imageHash?: string;
	mimeType: string;
	ok: boolean;
	/** 失败原因（ok=false 时） */
	error?: string;
	/** 单图请求耗时 ms（缓存命中为 0） */
	durationMs: number;
	/** 命中描述缓存，未实际请求视觉模型 */
	cached: boolean;
	/** 成功描述（截断，详情展示用；完整描述在消息文本里） */
	description?: string;
	/** 输出 token 数（响应带 usage 时） */
	outputTokens?: number;
};

export type VisionBridgeEvent = {
	ts: number;
	/** 转换来源：input=用户发图 / tool_result=工具读图 / request=provider payload 兜底 */
	kind: "input" | "tool_result" | "request";
	/** provider/model，如 "deepseek/deepseek-chat" */
	model: string;
	/** 提示词模板（截断，展示用） */
	prompt: string;
	/** 本批总耗时 ms */
	totalDurationMs: number;
	items: VisionEventItem[];
};
