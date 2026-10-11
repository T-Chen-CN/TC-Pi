import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("hover-card i18n copy is synchronized between zh-CN and en-US", () => {
	const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
	const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

	const keys = ["sidebar.hoverCard.workspace", "sidebar.hoverCard.updatedAt", "sidebar.hoverCard.emptyPreview", "sidebar.hoverCard.localTask", "sidebar.hoverCard.messageCount"];

	for (const key of keys) {
		assert.match(zh, new RegExp(`"${key.replace(/\./g, "\\.")}":`));
		assert.match(en, new RegExp(`"${key.replace(/\./g, "\\.")}":`));
	}
});
