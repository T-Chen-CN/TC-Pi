/** 全局配置只包含配置文本和资源目录；认证凭据仍由 pi-auth 管理。 */
const RESOURCE_DIRECTORIES = new Set(["agents", "prompts", "skills", "extensions", "themes"]);

export function isPiConfigRelativePath(path: string): boolean {
	const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
	if (parts.some((part) => part === "." || part === "..")) return false;
	if (!parts.length) return true;
	const first = parts[0].toLowerCase();
	if (first === "auth.json") return false;
	if (RESOURCE_DIRECTORIES.has(first)) return true;
	return parts.length === 1 && /\.(?:json|jsonc|md|txt|ya?ml|toml|ini)$/i.test(first);
}
