import { ConfirmDialog } from "../ui-shadcn/ConfirmDialog";
import { t } from "../../i18n";

/** 忙碌 Agent 的终止确认；取消、Escape 与关闭都结算同一个切换请求。 */
export function WorkspaceSwitchDialog(props: { busyCount?: number; onRespond: (value: boolean) => void }) {
	return props.busyCount === undefined ? null : <ConfirmDialog title={t("workspace.switchTitle")} message={t("workspace.switchBusy", { count: props.busyCount })} confirmLabel={t("workspace.switchConfirm")} danger onConfirm={() => props.onRespond(true)} onCancel={() => props.onRespond(false)} />;
}
