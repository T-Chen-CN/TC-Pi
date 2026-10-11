import type { AgentBackend } from "../../../../../shared/types";
import { t } from "../../../i18n";
import { Avatar, AvatarFallback } from "../../ui-shadcn/avatar";
import { PiLogo } from "../SessionSourceBadge";
import { formatTime } from "../TimelineFormat";

export function TurnAuthorHeader(props: { backend?: AgentBackend; endedAt: number }) {
	const backend: AgentBackend = props.backend ?? "pi";

	const name = t("sessionBackend.pi");

	return (
		<div className="mb-1 flex items-center gap-2" data-turn-author={backend} aria-label={name}>
			<Avatar title={name} className="bg-muted text-foreground">
				{/* 无 AvatarImage：品牌 logo 是矢量资源，失败态就是正常态。 */}
				<AvatarFallback delayMs={0} className="bg-transparent text-current">
					<PiLogo className="size-4" />
				</AvatarFallback>
			</Avatar>
			{/* 时间/耗时数字统一走界面字体（与输入框下方统计条一致），不跟代码/路径一起用等宽字体；
			    数字本身等宽，流式跳动也不会左右抖（Segoe UI 等基数字体实测通过）。 */}
			<time className="shrink-0 text-body leading-none text-muted-foreground tabular-nums">{formatTime(props.endedAt)}</time>
		</div>
	);
}
