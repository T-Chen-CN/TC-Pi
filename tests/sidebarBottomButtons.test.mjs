import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 底栏动作（设置/搜索/定时任务/主题切换）使用 beUI Dock（motion/dock）：
 * 浮动卡片容器铺满底栏宽度（w-full + justify-between 均匀分布四个动作）；
 * 按钮本体仍是 shadcn ghost Button，aria-label 与 onClick 回调保持原契约；
 * 四入口 hover 提示统一 styled Tooltip（side="right"/delay 300），原生 title
 * 全部退场（会与 Tooltip 双弹且样式割裂）；
 * 主题按钮的图标/文案反映当前模式，翻转规则由 themeAppearance.toggleThemeMode 承担。
 */

const sidebar = readFileSync("src/renderer/src/components/sidebar/SidebarContent.tsx", "utf8");

test("v3 sidebar bottom actions render inside a full-width beUI Dock", () => {
	assert.match(sidebar, /import \{ Dock, DockItem \} from "\.\.\/motion\/dock";/);
	assert.match(sidebar, /<Dock size=\{32\} className="w-full justify-between">/);
	// 四个常用动作固定排列；官网链接由顶部 AboutPopover 承载。
	assert.equal((sidebar.match(/<DockItem>/g) || []).length, 4);
});

test("dock retains settings updates and theme alongside search and automation", () => {
	const dockBlock = sidebar.slice(sidebar.indexOf("<Dock size={32}"), sidebar.indexOf("</Dock>"));
	assert.match(sidebar, /<UpdateDotHint\s+hasPendingUpdate=\{hasPendingUpdate\}/);
	assert.match(dockBlock, /aria-label=\{hasPendingUpdate \? t\("settings.titleWithUpdate"\) : t\("settings.title"\)\}[\s\S]*?onClick=\{props\.onOpenSettings\}/);
	assert.match(dockBlock, /aria-label=\{t\("app.searchSessions"\)\}[\s\S]*?onClick=\{\(\) => setSearchOpen\(true\)\}/);
	assert.match(dockBlock, /<kbd[^>]*>\{searchKbd\}/);
	assert.match(dockBlock, /<AutomationDockButton\s*\/>/);
	assert.match(dockBlock, /aria-label=\{themeToggleTitle\}[\s\S]*?onClick=\{props\.onToggleTheme\}/);
	assert.equal((dockBlock.match(/<Tooltip\s+delayDuration=\{300\}>/g) ?? []).length, 3);
	assert.equal((dockBlock.match(/variant="ghost"/g) ?? []).length, 3);
	assert.doesNotMatch(dockBlock, /AnnouncementCenter|onOpenFeedback|title=\{themeToggleTitle\}/);
	const about = readFileSync("src/renderer/src/components/app/AboutPopover.tsx", "utf8");
	assert.match(about, /WEBSITE_URL = "https:\/\/pideck\.caoayu\.top\/"/);
	assert.match(about, /label=\{t\("about\.website"\)\}/);
});

test("legacy toolbar/icon-button bottom bar classes are gone", () => {
	assert.doesNotMatch(sidebar, /icon-button/);
	assert.doesNotMatch(sidebar, /toolbar-actions/);
	assert.doesNotMatch(sidebar, /sidebar-bottom-primary-actions/);
	assert.doesNotMatch(sidebar, /settings-icon|feedback-icon|homepage-icon/);
});
