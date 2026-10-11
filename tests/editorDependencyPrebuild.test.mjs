import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync("electron.vite.config.ts", "utf8");

test("renderer owns an isolated dependency cache rather than sharing other Vite entry caches", () => {
	// 留在 node_modules 内，React 开发插件不会再次 Babel 编译已经预构建的依赖。
	assert.match(config, /renderer:\s*\{\s*(?:\/\/[^\n]*\n\s*)*cacheDir:\s*resolve\(__dirname,\s*"node_modules\/\.vite-pideck-renderer"\)/);
});

test("all core editor language dependencies are optimized before the first file opens", () => {
	const include = config.slice(config.indexOf("optimizeDeps:"), config.indexOf("resolve:", config.indexOf("optimizeDeps:")));
	for (const path of ["src/renderer/src/components/app/CodeMirrorEditor.tsx", "src/renderer/src/utils/codemirrorSetup.ts"]) {
		const source = readFileSync(path, "utf8");
		for (const [, dependency] of source.matchAll(/from\s+"(@codemirror\/[^"\n]+|@lezer\/highlight)"/g)) {
			assert.ok(include.includes(`"${dependency}"`), `${dependency} must not first trigger optimization while opening a file`);
		}
	}
});
