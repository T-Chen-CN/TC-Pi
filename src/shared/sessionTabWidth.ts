/** 出厂默认：与旧硬编码 max-w-[104px] 一致 */
export const SESSION_TAB_MAX_WIDTH_DEFAULT = 104;

/** 合理区间下限（px）：低于此值标题截断后基本不可读 */
export const SESSION_TAB_MAX_WIDTH_MIN = 80;

/** 合理区间上限（px）：超过后单 Tab 独占半条栏 */
export const SESSION_TAB_MAX_WIDTH_MAX = 400;

export const SESSION_TAB_BADGE_EXTRA_WIDTH = 28;

/** 把任意来源（settings.json 磁盘值 / UI 输入）的宽度收敛到合法区间；非有限数值回落默认。 */
export function clampSessionTabMaxWidth(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return SESSION_TAB_MAX_WIDTH_DEFAULT;
	return Math.min(SESSION_TAB_MAX_WIDTH_MAX, Math.max(SESSION_TAB_MAX_WIDTH_MIN, Math.round(value)));
}
