import { win32, posix } from "node:path";

export type InstallPaths = {
	root: string;
	data: string;
	desktop: string;
	piAgent: string;
	piSessions: string;
	agentsSkills: string;
	browser: string;
	cache: string;
	npmCache: string;
	logs: string;
	backups: string;
	temp: string;
	runtimes: string;
	voice: string;
	updates: string;
};

/** Resolve storage without Electron or disk access; every managed path belongs to one installation. */
export function resolveInstallPaths(input: { isPackaged: boolean; exePath: string; appPath: string; platform?: NodeJS.Platform; portableDir?: string; appImage?: string; devProfile?: string; explicitDesktop?: string }): InstallPaths {
	const platform = input.platform ?? process.platform;
	const path = platform === "win32" ? win32 : posix;
	const profile = input.devProfile ?? "main";
	if (!/^[\w.-]{1,160}$/.test(profile) || profile === "." || profile === "..") throw new Error("Invalid development storage profile");
	let root: string;
	if (input.explicitDesktop) root = path.resolve(input.explicitDesktop);
	else if (!input.isPackaged) root = path.join(input.appPath, ".tc-pi-dev", profile);
	else if (platform === "win32" && input.portableDir) root = path.resolve(input.portableDir);
	else if (platform === "linux" && input.appImage) root = path.dirname(path.resolve(input.appImage));
	else if (platform === "darwin") {
		// Keep mutable files beside the signed bundle, never inside Contents/Resources.
		const bundle = input.exePath.match(/^(.*\.app)\//)?.[1];
		root = bundle ? path.join(path.dirname(bundle), "TC-Pi") : path.dirname(input.exePath);
	} else root = path.dirname(input.exePath);
	root = path.resolve(root);
	const data = input.explicitDesktop ? root : path.join(root, "data");
	const runtimes = path.join(root, "runtimes");
	return {
		root,
		data,
		desktop: input.explicitDesktop ? root : path.join(data, "desktop"),
		piAgent: path.join(data, "pi"),
		piSessions: path.join(data, "pi", "sessions"),
		agentsSkills: path.join(data, "pi", "agents-skills"),
		browser: path.join(data, "browser"),
		cache: path.join(data, "cache"),
		npmCache: path.join(data, "cache", "npm"),
		logs: path.join(data, "logs"),
		backups: path.join(data, "backups"),
		temp: path.join(data, "temp"),
		runtimes,
		voice: path.join(runtimes, "voice"),
		updates: path.join(data, "cache", "updates"),
	};
}

/** Scope tool caches without pretending the user's HOME is another directory. */
export function installRuntimeEnvironment(paths: InstallPaths, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const windows = /^[A-Za-z]:\\|^\\\\/.test(paths.root);
	const join = windows ? win32.join : posix.join;
	const executablePath = [join(paths.runtimes, "node", ...(windows ? [] : ["bin"])), join(paths.runtimes, "pi-global", ...(windows ? [] : ["bin"])), join(paths.runtimes, "pi", "bin"), join(paths.runtimes, "git", windows ? "cmd" : "bin"), inherited.PATH ?? inherited.Path ?? ""].join(windows ? ";" : ":");
	return {
		...inherited,
		PATH: executablePath,
		...(windows ? { Path: executablePath } : {}),
		TC_PI_INSTALL_ROOT: paths.root,
		TC_PI_DATA_ROOT: paths.data,
		TC_PI_RUNTIME_ROOT: paths.runtimes,
		PI_CODING_AGENT_DIR: paths.piAgent,
		// Pi derives per-project session directories from agentDir. Drop a stale global override.
		PI_CODING_AGENT_SESSION_DIR: undefined,
		// Managed launchers calculate their own install root; inherited values may point at an old global Pi.
		PI_MANAGED_INSTALL_ROOT: undefined,
		PI_PACKAGE_DIR: undefined,
		NODE_COMPILE_CACHE: join(paths.cache, "node"),
		npm_config_cache: paths.npmCache,
		NPM_CONFIG_CACHE: paths.npmCache,
		npm_config_prefix: join(paths.runtimes, "pi-global"),
		NPM_CONFIG_PREFIX: join(paths.runtimes, "pi-global"),
		npm_config_userconfig: join(paths.data, "npmrc"),
		NPM_CONFIG_USERCONFIG: join(paths.data, "npmrc"),
		COREPACK_HOME: join(paths.runtimes, "corepack"),
		GIT_CONFIG_GLOBAL: join(paths.data, "gitconfig"),
		GIT_CONFIG_NOSYSTEM: "1",
		UV_CACHE_DIR: join(paths.cache, "uv"),
		PIP_CACHE_DIR: join(paths.cache, "pip"),
		HF_HOME: join(paths.cache, "huggingface"),
		TORCH_HOME: join(paths.cache, "torch"),
		PLAYWRIGHT_BROWSERS_PATH: join(paths.runtimes, "browsers"),
		JITI_CACHE_DIR: join(paths.cache, "jiti"),
		XDG_CACHE_HOME: paths.cache,
		TEMP: paths.temp,
		TMP: paths.temp,
		TMPDIR: paths.temp,
	};
}
