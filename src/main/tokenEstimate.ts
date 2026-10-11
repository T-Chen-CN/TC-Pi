/** CJK 范围：中日韩统一表意 + 扩展A + 全角符号 + 假名 + 谚文。 */
function isCjkChar(code: number): boolean {
	return (
		(code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意
		(code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
		(code >= 0x3000 && code <= 0x303f) || // CJK 标点
		(code >= 0xff00 && code <= 0xffef) || // 全角/半角形式
		(code >= 0x3040 && code <= 0x30ff) || // 假名
		(code >= 0xac00 && code <= 0xd7af) || // 谚文音节
		(code >= 0x1100 && code <= 0x11ff) // 谚文字母
	);
}

/**
 * 把混排文本折算成 token 估算：中文按 1.5 字/token，其余按 4 字符/token，向上取整。
 * 这是估算而非精确分词——用于圆环「对话/系统+工具」分段展示，误差可接受且方向稳定。
 */
export function estimateTokensFromText(text: string): number {
	if (!text) return 0;
	let cjk = 0;
	let other = 0;
	for (const ch of text) {
		if (isCjkChar(ch.codePointAt(0) ?? 0)) cjk++;
		else other++;
	}
	return Math.ceil(cjk / 1.5 + other / 4);
}

/**
 * 估算任意 JSON 值序列化后的 token 数。工具调用参数/工具结果没有纯文本形态，
 * 统一按序列化字符数折算；结果侧超过 bytesCap 就截断采样，避免单个巨型读文件把估算撑爆。
 */
export function estimateTokensFromJsonValue(value: unknown, bytesCap = 64 * 1024): number {
	if (value == null) return 0;
	let text: string;
	try {
		text = typeof value === "string" ? value : JSON.stringify(value);
	} catch {
		return 0;
	}
	if (text.length > bytesCap) text = text.slice(0, bytesCap);
	return estimateTokensFromText(text);
}
