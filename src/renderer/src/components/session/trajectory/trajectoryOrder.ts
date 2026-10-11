import type { ChatMessage } from "../../../../../shared/types";
import type { TrajectoryRecord, TrajectoryRecordKind, TrajectoryTurn } from "./buildTrajectory";

export function wallTime(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
	if (value > 1e9 && value < 1e11) return Math.round(value * 1000);
	return value;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function seqOfMessage(message: ChatMessage): number | undefined {
	const fromMeta = asNumber(message.meta?.seq);
	if (fromMeta !== undefined) return fromMeta;
	const match = /^dsh:(\d+)$/.exec(message.id);
	if (!match) return undefined;
	const seq = Number(match[1]);
	return Number.isFinite(seq) ? seq : undefined;
}

function kindTie(kind: TrajectoryRecordKind): number {
	if (kind === "systemPrompt") return 0;
	if (kind === "user") return 1;
	if (kind === "thinking") return 2;
	if (kind === "assistant") return 3;
	if (kind === "tool") return 4;
	if (kind === "process") return 5;
	if (kind === "error") return 6;
	return 7;
}

export function compareTrajectoryRecords(left: TrajectoryRecord, right: TrajectoryRecord): number {
	if (left.kind === "systemPrompt" && right.kind !== "systemPrompt") return -1;
	if (right.kind === "systemPrompt" && left.kind !== "systemPrompt") return 1;
	const leftSeq = left.seq;
	const rightSeq = right.seq;
	if (leftSeq !== undefined && rightSeq !== undefined && leftSeq !== rightSeq) {
		return leftSeq - rightSeq;
	}
	const leftTime = left.startedAt > 0 ? left.startedAt : Number.POSITIVE_INFINITY;
	const rightTime = right.startedAt > 0 ? right.startedAt : Number.POSITIVE_INFINITY;
	if (leftTime !== rightTime) return leftTime - rightTime;
	return kindTie(left.kind) - kindTie(right.kind);
}

export function sortTurnRecords(turn: TrajectoryTurn): void {
	turn.records.sort(compareTrajectoryRecords);
}
