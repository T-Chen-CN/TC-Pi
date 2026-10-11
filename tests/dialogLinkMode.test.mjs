import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("config diagnostic docs link forces system browser", () => {
	const src = readFileSync("src/renderer/src/ConfigModal.tsx", "utf8");
	assert.match(src, /onOpenDocs=\{\(\) => api\.app\.openExternal\(configDiagnostic\.docsUrl, true\)\}/);
});

test("environment dialog nodejs link forces system browser in dialog implementations", () => {
	// OverlayComponents 版是 EnvironmentDialog 唯一实现（含 pi 环境三步引导）；
	// AppParts 现在只 re-export，不再持实现。两处 nodejs.org 外链都必须 forceSystem。
	const overlay = readFileSync("src/renderer/src/components/overlays/OverlayComponents.tsx", "utf8");
	assert.match(overlay, /window\.piDesktop\.app\.openExternal\(\s*"https:\/\/nodejs\.org\/zh-cn\/download\/",\s*true\s*\)/);
	const guide = readFileSync("src/renderer/src/components/overlays/EnvironmentGuidePanel.tsx", "utf8");
	assert.match(guide, /openExternal\("https:\/\/nodejs\.org\/zh-cn\/download\/", true\)/);
});

test("settings web service link forces system browser", () => {
	const src = readFileSync("src/renderer/src/components/app/SettingsFeatureRoot.tsx", "utf8");
	// forceSystem=true：Web 服务页必须离开内置浏览器面板——面板在 Dialog 下层，
	// 设置弹窗打开时会被遮挡；且外部端按桌面浏览器视口设计，系统浏览器体验更完整。
	// URL 组装已移到 WebTab（previewUrl = buildWebAccessUrl(previewHostFromBinding(...))），
	// 回调只负责带 forceSystem 转发——契约守第二个参数，不断言具体 URL 拼接位置。
	assert.match(src, /onOpenWebService: \(url: string\) => api\.app\.openExternal\(url, true\)/);
});
