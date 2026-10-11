import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readRendererStyles } from "./helpers/rendererStyles.mjs";

/**
 * pure official P2-2：子行尺寸/hover 由组件 Tailwind 承担。
 * 仍保留 session-card 透明容器与状态徽标契约。
 */

const styles = readRendererStyles();
const titleScrollText = readFileSync("src/renderer/src/components/sidebar/TitleScrollText.tsx", "utf8");
const agentListDisplay = readFileSync("src/renderer/src/agentListDisplay.ts", "utf8");
const tabBar = readFileSync("src/renderer/src/components/session/SessionTabsBar.tsx", "utf8");
const sessionView = readFileSync("src/renderer/src/components/session/SessionView.tsx", "utf8");
const sourceBadge = readFileSync("src/renderer/src/components/session/SessionSourceBadge.tsx", "utf8");

test("sidebar workspace wrapper stays transparent", () => {
	const workspaceCard = styles.match(/\.chat-list-pane\.v3-braun \.sidebar-body \.session-card \{([\s\S]*?)\n\}/)?.[1];
	assert.ok(workspaceCard, "sidebar workspace card styles must exist");
	assert.match(workspaceCard, /background:\s*transparent;/);
	assert.match(workspaceCard, /border:\s*0;/);
	assert.match(workspaceCard, /overflow:\s*visible;/);
});

test("text backend badge keeps its width instead of covering tab actions", () => {
	// DSH 标记是文字徽标，不能继续复用图标徽标的固定正方形宽度；否则文本会溢出并覆盖右侧操作按钮。
	assert.doesNotMatch(tabBar, /SessionBackendBadge className=\"size-4 shrink-0\"/);
	assert.match(sourceBadge, /h-4 rounded px-1/);
});

test("session tabs stay outside SessionView; header is standalone in pane", () => {
	assert.match(tabBar, /actions\?: ReactNode/);
	assert.match(tabBar, /props\.onToggleDrawer \? \(/);
	// Tab 栏外置后，SessionView 只渲染独立 Header，不再把操作嵌入 Tab 的 actions 槽。
	assert.doesNotMatch(sessionView, /SessionTabsBar/);
	// header 不再接收 widget chips（2026-08 移除：待办统一走输入框上方常驻条）
	assert.doesNotMatch(sessionView, /widgetChips/);
	assert.doesNotMatch(sessionView, /embedded/);
});
