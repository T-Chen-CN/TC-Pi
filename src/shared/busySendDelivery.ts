/** 忙碌时默认投递行为：steer=插入当前回合（尽快送达）；followUp=排队到下一轮 */
export type BusySendDelivery = "steer" | "followUp";

export const DEFAULT_BUSY_SEND_DELIVERY: BusySendDelivery = "steer";

/**
 * 解析持久化/渲染层传入的投递行为配置。
 * 磁盘 JSON 无类型，旧数据或坏值一律回落默认（steer），不抛错。
 */
export function parseBusySendDelivery(value: unknown): BusySendDelivery {
	return value === "followUp" ? "followUp" : DEFAULT_BUSY_SEND_DELIVERY;
}

/**
 * 忙碌时发送的统一决策入口：
 * - 空闲 → undefined（直发，无需队列语义）；
 * - 忙碌 → 按设置返回 "steer" | "followUp"。
 * 渲染层的入队快捷路径与 flush 投递都消费该结果。
 */
export function resolveBusySendDelivery(busy: boolean, configured: unknown): BusySendDelivery | undefined {
	if (!busy) return undefined;
	return parseBusySendDelivery(configured);
}
