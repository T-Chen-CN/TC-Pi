export const PROVIDER_NAME_MAX_LENGTH = 80;

/** 与主进程的配置安全边界一致：拒绝路径、控制字符、`%` 和超长名称。 */
export function isValidProviderName(name: string): boolean {
	if (typeof name !== "string") return false;
	const trimmed = name.trim();
	return trimmed.length > 0 && trimmed.length <= PROVIDER_NAME_MAX_LENGTH && trimmed !== "__proto__" && !/[\\/\u0000-\u001f\u007f%]/.test(name) && !trimmed.includes("..");
}

export const PROVIDER_NAME_RULE_I18N_KEY = "config.providerNameRule";
