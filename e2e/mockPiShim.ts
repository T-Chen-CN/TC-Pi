/** Windows 批处理按当前代码页读取后续行，先切换 UTF-8 保证中文仓库路径可执行。 */
export function mockPiShim(platform: NodeJS.Platform, nodePath: string, scriptPath: string): string {
	return platform === "win32" ? `@echo off\r\nchcp 65001 >nul\r\n"${nodePath}" "${scriptPath}" %*\r\n` : `#!/bin/sh\nexec "${nodePath}" "${scriptPath}" "$@"\n`;
}
