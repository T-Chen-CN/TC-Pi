import { BarChart3 } from "lucide-react";
import type { UsageProbeBackend } from "../../../../shared/types/providerUsage";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";

export function UsageQueryEntryButton(props: { provider: string; backend?: UsageProbeBackend; onOpen: () => void; className?: string; iconClassName?: string }) {
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			className={props.className ?? "size-7"}
			onClick={(e) => {
				e.stopPropagation();
				props.onOpen();
			}}
			title={t("config.usageProbe.entry")}
			aria-label={t("config.usageProbe.entry")}
			data-testid="provider-usage-configure-icon"
		>
			<BarChart3 className={props.iconClassName ?? "size-3.5"} aria-hidden="true" />
		</Button>
	);
}
