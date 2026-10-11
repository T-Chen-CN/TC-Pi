/** TC-Pi 仅使用自己的 GitHub Releases，历史镜像设置统一回落。 */
import type { UpdateSourceId } from "../../shared/types/settings";
export { normalizeCustomMirrorHost } from "../../shared/updateSources";

/** 防止旧镜像设置恢复上游更新路径。 */
export function normalizeUpdateSource(_source: unknown): UpdateSourceId {
	return "github";
}
export type UpdateSourceOption = { id: UpdateSourceId; labelKey: string; host: string | null; feedUrl: string | null };
/** 设置页仅提供当前仓库的原生 GitHub provider。 */
export function updateSourceOptions(): UpdateSourceOption[] {
	return [{ id: "github", labelKey: "github", host: null, feedUrl: null }];
}
/** null 使用 TC-Pi 打包配置或运行时兜底配置。 */
export function updateSourceFeedUrl(_source: UpdateSourceId, _customHost?: string | null): string | null {
	return null;
}
/** macOS 复用当前 GitHub Release 地址。 */
export function updateSourceLatestReleaseUrl(_source: UpdateSourceId, _customHost?: string | null): string | null {
	return null;
}
