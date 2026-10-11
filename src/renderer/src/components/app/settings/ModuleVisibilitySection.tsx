import { memo } from "react";
import type { AppSettings } from "../../../../../shared/types";
import { HIDEABLE_MODULE_IDS, isModuleHidden, toggleHiddenModule, type HideableModuleId } from "../../../../../shared/hiddenModules";
import { t, type TranslationKey } from "../../../i18n";
import { Badge } from "../../ui-shadcn/badge";
import { SettingsSection } from "./SettingsStorageTab";
import { DirtyMarker, SettingRow } from "./SettingRows";
import { Switch } from "../../ui-shadcn/switch";
import { SETTINGS_TAB_LABEL_KEYS } from "./settingsTabLayout";

type ModuleVisibilitySectionProps = {
	draft: AppSettings;
	updateDraft: (patch: Partial<AppSettings>) => void;
	isDirty: (field: keyof AppSettings) => boolean;
};

/** 各模块行的标题 key：设置 tab 直接复用侧栏标题（命令面板同源）。 */
const MODULE_LABEL_KEYS: Record<HideableModuleId, TranslationKey> = {
	hostplugins: SETTINGS_TAB_LABEL_KEYS.hostplugins,
	web: SETTINGS_TAB_LABEL_KEYS.web,
	git: SETTINGS_TAB_LABEL_KEYS.git,
	usage: SETTINGS_TAB_LABEL_KEYS.usage,
	process: SETTINGS_TAB_LABEL_KEYS.process,
	composerModes: "settings.modules.composerModes",
};

/** 每个模块隐藏后受影响的入口说明（行描述）。 */
const MODULE_DESC_KEYS: Record<HideableModuleId, TranslationKey> = {
	hostplugins: "settings.modules.hostpluginsDesc",
	web: "settings.modules.webDesc",
	git: "settings.modules.gitDesc",
	usage: "settings.modules.usageDesc",
	process: "settings.modules.processDesc",
	composerModes: "settings.modules.composerModesDesc",
};

export const ModuleVisibilitySection = memo(function ModuleVisibilitySection(props: ModuleVisibilitySectionProps) {
	const { draft, updateDraft, isDirty } = props;
	const hiddenModules = draft.hiddenModules ?? [];

	const activeBadge = (moduleId: HideableModuleId): TranslationKey | null => {
		switch (moduleId) {
			case "web":
				return draft.webServiceEnabled ? "settings.modules.statusEnabled" : null;
			case "git":
				return draft.enableGitManagement ? "settings.modules.statusEnabled" : null;
			case "usage":
			case "process":
			case "hostplugins":
			case "composerModes":
				return null;
		}
		return null;
	};

	return (
		/* 锚点供命令面板「功能模块」条目直达（utils/settingsFieldAnchors.ts 登记） */
		<SettingsSection
			id="settings-section-appearance-modules"
			title={
				<span className="inline-flex items-center gap-1.5">
					{t("settings.modules.title")}
					{/* 整组开关共用一个 AppSettings 字段，黄点挂在分区标题而非逐行（逐行会在改一项时全部亮起） */}
					<DirtyMarker dirty={isDirty("hiddenModules")} label={t("settings.modules.title")} />
				</span>
			}
			description={t("settings.modules.sectionDesc")}
		>
			{HIDEABLE_MODULE_IDS.map((moduleId) => {
				const hidden = isModuleHidden(hiddenModules, moduleId);
				const label = t(MODULE_LABEL_KEYS[moduleId]);
				const badgeKey = activeBadge(moduleId);
				return (
					<SettingRow
						key={moduleId}
						title={
							<>
								<span>{label}</span>
								{/* 活动状态徽标：只在模块被隐藏时才有提醒价值，显示中的模块状态在它自己的页面里看 */}
								{hidden && badgeKey ? (
									<Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground">
										{t(badgeKey)}
									</Badge>
								) : null}
							</>
						}
						description={t(MODULE_DESC_KEYS[moduleId])}
					>
						<Switch checked={!hidden} onCheckedChange={(checked) => updateDraft({ hiddenModules: toggleHiddenModule(hiddenModules, moduleId, !checked) })} aria-label={label} />
					</SettingRow>
				);
			})}
		</SettingsSection>
	);
});
