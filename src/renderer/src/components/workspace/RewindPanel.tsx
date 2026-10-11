import { History } from "lucide-react";
import { useAtomValue } from "jotai";
import { t } from "../../i18n";
import { currentSessionIdAtom } from "../../atoms/session-atoms";
import { sessionRecordByIdAtomFamily } from "../../atoms/session-selectors";
import { RewindCheckpointList } from "../session/RewindCheckpointList";

export function RewindPanel() {
	const sessionId = useAtomValue(currentSessionIdAtom);
	const sessionRecord = useAtomValue(sessionRecordByIdAtomFamily(sessionId ?? ""));
	const backend = sessionRecord?.backend;
	const unsupported = backend !== undefined && backend !== "pi";

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-1.5 px-3 pb-1 pt-2 text-xs font-semibold text-foreground">
				<History size={13} strokeWidth={1.8} aria-hidden="true" />
				{t("rewind.title")}
				<span className="ml-auto text-[10px] font-normal text-text-tertiary">{t("rewind.panelHint")}</span>
			</div>
			<div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-2 pb-2">
				{!sessionId ? (
					<div className="px-1 py-2 text-xs leading-5 text-text-secondary">
						<p>{t("rewind.noSession")}</p>
						<p className="mt-0.5 text-text-tertiary">{t("rewind.noSessionHint")}</p>
					</div>
				) : unsupported ? (
					<p className="px-1 py-2 text-xs text-destructive">{t("rewind.unsupportedBackend")}</p>
				) : (
					<RewindCheckpointList sessionId={sessionId} />
				)}
			</div>
		</div>
	);
}
