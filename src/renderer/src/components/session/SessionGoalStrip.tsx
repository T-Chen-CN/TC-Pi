import { useAtomValue } from "jotai";
import { Pause, Play, Target, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { sessionRuntimeBySessionIdAtomFamily, sessionRuntimeUiBySessionIdAtomFamily } from "../../atoms";
import { parsePiGoalWidget } from "../../composerBehavior";
import { desktopApi } from "../../desktopApi";
import { t } from "../../i18n";
import { showNotice } from "../../utils/notice";
import { Button } from "../ui-shadcn/button";
import { ConfirmDialog } from "../ui-shadcn/ConfirmDialog";
import { isCoherentComposerRuntimeUi, type RuntimeHandle } from "./ComposerRuntimeIntegrations";
import { ComposerWidgetFrame } from "./ComposerWidgetLayout";

/**
 *
 * 形态：与 todo / queue 同列同宽的独立 36px 卡（图标 + 阶段 + 截断目标 + 操作）。
 */
export function SessionGoalStrip(props: { sessionId: string }) {
	const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(props.sessionId));
	const runtimeUi = useAtomValue(sessionRuntimeUiBySessionIdAtomFamily(props.sessionId));
	const agentId = runtime?.agentId;
	const runtimeHandle: RuntimeHandle | undefined = runtime?.agentId ? { agentId: runtime.agentId, runtimeGeneration: runtime.runtimeGeneration } : undefined;
	const coherent = isCoherentComposerRuntimeUi(runtimeHandle, runtimeUi) ? runtimeUi : undefined;
	const piGoal = parsePiGoalWidget(coherent?.widgets?.["pi-deck-goal"]);
	const goal = piGoal
		? {
				phase: piGoal.phase,
				objective: piGoal.objective,
				roundsStarted: piGoal.roundsStarted,
				maxGoalRounds: piGoal.maxGoalRounds,
			}
		: undefined;
	const [busy, setBusy] = useState(false);
	const [confirmClear, setConfirmClear] = useState(false);
	const pendingRef = useRef(false);

	const runAction = useCallback(
		async (action: "pause" | "resume" | "clear") => {
			if (pendingRef.current) return;
			pendingRef.current = true;
			setBusy(true);
			try {
				{
					const command = action === "pause" ? "/goal pause" : action === "resume" ? "/goal resume" : "/goal clear";
					const result = await desktopApi.sessions.sendPrompt({
						sessionId: props.sessionId,
						requestId: crypto.randomUUID(),
						message: command,
					});
					if (!result.accepted) {
						showNotice(result.error ?? t("sessionGoal.switchFailed"), 4000);
					}
				}
			} catch (error) {
				showNotice(error instanceof Error ? error.message : String(error), 4000);
			} finally {
				pendingRef.current = false;
				setBusy(false);
			}
		},
		[props.sessionId],
	);

	// 无投影 / 已完成：不占输入区。blocked 仍展示，否则用户看不到卡住原因。
	if (!goal || goal.phase === "complete") return null;

	const phaseLabel = goal.phase === "paused" ? t("sessionGoal.Phase.paused") : goal.phase === "blocked" ? t("sessionGoal.Phase.blocked") : t("sessionGoal.Phase.active");

	return (
		<ComposerWidgetFrame data-testid="session-goal-strip" aria-label={t("sessionGoal.aria")}>
			<div className="flex h-9 w-full items-center gap-2.5 px-3">
				<Target size={14} aria-hidden="true" className="shrink-0 text-text-tertiary" />
				<span className="shrink-0 text-control font-medium leading-6 text-foreground">{phaseLabel}</span>
				<span className="min-w-0 flex-1 truncate text-control leading-5 text-text-tertiary" title={goal.objective}>
					{goal.objective}
				</span>
				<div className="flex shrink-0 items-center gap-0.5">
					{goal.phase === "active" ? (
						<Button
							variant="ghost"
							size="icon-xs"
							className="size-7 rounded-full text-text-tertiary"
							aria-label={t("sessionGoal.Pause")}
							title={t("sessionGoal.Pause")}
							disabled={busy}
							onClick={() => {
								void runAction("pause");
							}}
						>
							<Pause size={14} aria-hidden="true" />
						</Button>
					) : null}
					{/* paused 与 blocked 都给出恢复：blocked 若只能清除，条上就没有纠错入口。 */}
					{goal.phase === "paused" || goal.phase === "blocked" ? (
						<Button
							variant="ghost"
							size="icon-xs"
							className="size-7 rounded-full text-text-tertiary"
							aria-label={t("sessionGoal.Resume")}
							title={t("sessionGoal.Resume")}
							disabled={busy}
							onClick={() => {
								void runAction("resume");
							}}
						>
							<Play size={14} aria-hidden="true" />
						</Button>
					) : null}
					<Button
						variant="ghost"
						size="icon-xs"
						className="size-7 rounded-full text-text-tertiary hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
						aria-label={t("sessionGoal.Clear")}
						title={t("sessionGoal.Clear")}
						disabled={busy}
						onClick={() => {
							setConfirmClear(true);
						}}
					>
						<Trash2 size={14} aria-hidden="true" />
					</Button>
				</div>
			</div>
			{confirmClear ? (
				<ConfirmDialog
					title={t("sessionGoal.ClearConfirmTitle")}
					message={t("sessionGoal.ClearConfirmMessage")}
					danger
					confirmLabel={t("sessionGoal.Clear")}
					onConfirm={() => {
						setConfirmClear(false);
						void runAction("clear");
					}}
					onCancel={() => {
						setConfirmClear(false);
					}}
				/>
			) : null}
		</ComposerWidgetFrame>
	);
}
