import { homedir } from "node:os";
import { join } from "node:path";

/** The Pi SDK and desktop readers must resolve the same explicitly configured agent directory. */
export function getPiAgentDir(home = homedir()): string {
	const distro = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\/i.exec(home)?.[1];
	if (distro && process.env.TC_PI_DATA_ROOT) return getWslAgentDir(distro);
	return process.env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
}

/** Keep Linux Pi configuration in an installation-owned scope, separate from Windows shell settings. */
export function getWslAgentDir(distro: string, dataRoot = process.env.TC_PI_DATA_ROOT): string {
	if (!dataRoot || !distro || distro.length > 128 || /[\\/\x00-\x1f]/.test(distro) || distro === "." || distro === "..") throw new Error("Invalid managed WSL storage scope");
	return join(dataRoot, "pi-wsl", `distro-${encodeURIComponent(distro)}`);
}

/** Forward translated private paths to Linux while keeping Windows and Linux npm prefixes separate. */
export function managedWslEnvironment(env: NodeJS.ProcessEnv, distro: string): NodeJS.ProcessEnv {
	if (!env.TC_PI_DATA_ROOT || !env.TC_PI_RUNTIME_ROOT) return env;
	const next: NodeJS.ProcessEnv = { ...env, PI_CODING_AGENT_DIR: getWslAgentDir(distro, env.TC_PI_DATA_ROOT), npm_config_prefix: join(env.TC_PI_RUNTIME_ROOT, "wsl", `distro-${encodeURIComponent(distro)}`, "npm-global") };
	next.WSLENV = [env.WSLENV, ...["PI_CODING_AGENT_DIR", "TEMP", "TMP", "TMPDIR", "npm_config_cache", "npm_config_prefix", "npm_config_userconfig", "UV_CACHE_DIR", "PIP_CACHE_DIR", "JITI_CACHE_DIR", "NODE_COMPILE_CACHE", "GIT_CONFIG_GLOBAL"].map((name) => `${name}/p`), "GIT_CONFIG_NOSYSTEM"].filter(Boolean).join(":");
	return next;
}

/** Global compatibility skills stay in the installation when managed storage is active. */
export function getGlobalAgentsSkillsDir(home = homedir()): string {
	return process.env.TC_PI_DATA_ROOT ? join(getPiAgentDir(home), "agents-skills") : join(home, ".agents", "skills");
}

/** Use local runtimes only after bootstrap; isolated legacy tests can still supply their own homes. */
export function getManagedRuntimeRoot(): string | undefined {
	return process.env.TC_PI_RUNTIME_ROOT;
}
