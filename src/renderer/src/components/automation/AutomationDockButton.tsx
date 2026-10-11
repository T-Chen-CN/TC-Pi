import { useAtomValue, useSetAtom } from "jotai";
import { ListTodo } from "lucide-react";
import { openAutomationModalAtom } from "../../atoms/automation-atoms";
import { automationActiveRunsAtom } from "../../atoms/automation-atoms";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui-shadcn/tooltip";

/**
 * 底栏的定时任务图标：复用现有管理弹框入口与运行状态。
 * 有任务执行时保留圆点，并在提示与读屏文案中显示数量。
 */
export function AutomationDockButton() {
	const openAutomationModal = useSetAtom(openAutomationModalAtom);
	const activeRuns = useAtomValue(automationActiveRunsAtom);
	const hasActive = activeRuns.length > 0;
	const label = hasActive ? `${t("automation.title")} (${activeRuns.length})` : t("automation.title");

	return (
		<Tooltip delayDuration={300}>
			<TooltipTrigger asChild>
				<Button type="button" variant="ghost" className="relative size-full rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={label} onClick={() => openAutomationModal()}>
					<ListTodo className="size-4" aria-hidden="true" />
					{hasActive && <span className="pointer-events-none absolute right-1 top-1 size-1.5 rounded-full bg-sky-500 animate-pulse" aria-hidden="true" />}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="right" sideOffset={6}>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}
