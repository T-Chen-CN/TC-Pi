import type { AppSettings } from "../../../../../shared/types/settings";
import { gitHubReleasesBase } from "../../../../../shared/updateSources";
import { t } from "../../../i18n";
import { SettingRow } from "./SettingRows";

/** 更新来源固定为自己的仓库，展示实际地址，避免旧镜像选项误导用户。 */
export function UpdateSourceSetting(_props: { draft: AppSettings; updateDraft: (patch: Partial<AppSettings>) => void }) {
	return (
		<SettingRow title={t("settings.updateSource")} description={t("settings.updateSourceFeedPreview", { url: `${gitHubReleasesBase()}/releases` })}>
			<span className="text-sm text-muted-foreground">{t("settings.updateSourceGithub")}</span>
		</SettingRow>
	);
}
