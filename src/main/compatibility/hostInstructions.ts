export function stripFeishuDocActionHint(text: string): string {
	return text.replace(/\n{0,2}\[PiDeck 飞书能力\][\s\S]*$/, "").trim();
}

/**
 * 清洗同步到飞书的 assistant 正文：
 * - 去掉 <thinking> 标签块
 * - 去掉残留的 SEND_FILE/CREATE_DOC 动作标记
 * - 去掉 PiDeck 内部能力提示与宿主注入说明
 * 只保留用户可见的最终回复。
 */
/** 宿主注入给模型的内部指令边界（不应对用户展示）。 */
export const HOST_INSTRUCTION_START = "[PIDECK_HOST_INSTRUCTION]";
export const HOST_INSTRUCTION_END = "[/PIDECK_HOST_INSTRUCTION]";

/**
 * 剥离宿主注入的内部指令，只保留用户可见输入。
 * 兼容历史会话：未加标记时，按已知飞书指令前缀/特征行剥离。
 */
export function stripHostInstruction(text: string): string {
	if (!text) return "";
	let next = text.replace(/\r\n/g, "\n");

	// 新格式：明确边界标记
	next = next.replace(/\[PIDECK_HOST_INSTRUCTION\][\s\S]*?\[\/PIDECK_HOST_INSTRUCTION\]\s*/g, "");

	// 历史格式：指令直接拼在用户消息前。
	// 旧实现用 join("\n") 拼多行指令，再 "\n\n" + 用户原文；
	// 也兼容 content 数组拼接后只有单换行的情况。
	if (next.startsWith("当前会话已连接飞书聊天")) {
		// 优先按双换行切开（指令块 / 用户原文）
		const parts = next.split(/\n\n+/);
		if (parts.length >= 2 && parts[0].includes("SEND_FILE")) {
			next = parts.slice(1).join("\n\n");
		} else {
			// 单换行兜底：去掉所有“宿主指令特征行”，保留其余
			next = next
				.split("\n")
				.filter((line) => {
					const t = line.trim();
					if (!t) return true;
					if (t.startsWith("当前会话已连接飞书聊天")) return false;
					if (t.startsWith("当前绑定的飞书 chat_id:")) return false;
					if (t.includes("严禁调用 lark-cli")) return false;
					if (t.includes("这是只读上下文，用于确认当前会话绑定")) return false;
					if (t.includes("创建飞书文档时，先输出完整正文")) return false;
					if (t === "这是飞书群聊消息。请直接回复用户。") return false;
					return true;
				})
				.join("\n");
		}
	}

	// 飞书来源尾部宿主说明
	next = next.replace(/\n{0,2}\[这是飞书群聊消息。请直接回复用户。\]\s*$/g, "").replace(/\n{0,2}\[飞书群聊消息。请直接回复用户。\]\s*$/g, "");

	return next.replace(/\n{3,}/g, "\n\n").trim();
}
