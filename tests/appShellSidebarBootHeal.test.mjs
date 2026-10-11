import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * 回归守卫：boot 期钉住抽屉约束重解把侧栏挤到 0（2026-10 用户反馈「启动后左侧栏丢失」）。
 *
 * 根因：boot 恢复「右侧文件工作区」钉住状态时，drawer 面板约束异步从
 * collapsible:true/minSize:240 变为 collapsible:false/minSize:260（DRAWER_WIDTH_MIN_PINNED），
 * react-resizable-panels v4 重解布局把 drawer 从 0 撑到 260，供体优先选唯一可折叠的
 * list 面板 → list 归零；listWidth/listCollapsed 状态均未变化，既有 heal effect 不重跑，
 * handleLayoutChanged 又因 !isUserInteraction 早退 → 侧栏永久丢失。
 *
 * 修复：handleLayoutChanged 的非交互分支在早退前自愈——list 状态未折叠但面板
 * isCollapsed() 时经统一整组布局入口恢复，保护列表与会话的宽度。
 * 本测试用空白容忍正则断言该分支存在，防止重构时丢失。
 */

const appShellPath = fileURLToPath(new URL("../src/renderer/src/components/app/AppShell.tsx", import.meta.url));
const source = readFileSync(appShellPath, "utf8");

test("handleLayoutChanged 非交互分支包含侧栏零宽自愈", () => {
	const nonUserBranch = /if\s*\(\s*!\s*meta\.isUserInteraction\s*\)\s*\{[\s\S]*?\n[\t ]*\}/.exec(source);
	assert.ok(nonUserBranch, "handleLayoutChanged 应保留非交互（!meta.isUserInteraction）分支");
	const branch = nonUserBranch[0];
	assert.match(branch, /listPanelRef\.current/, "非交互分支应读取 list 面板句柄");
	assert.match(branch, /listPanel\.isCollapsed\s*\(\s*\)/, "自愈应检查 list 面板是否被库重解挤到折叠");
	assert.match(branch, /panelLayout\.syncPanelLayout\s*\(\s*\)/, "自愈应原子恢复保存的布局宽度");
	assert.match(branch, /!\s*listCollapsed/, "自愈仅在状态未折叠时触发，不得与用户主动折叠打架");
});

test("自愈不再通过全栏回写改变宽度偏好", () => {
	const healIndex = source.indexOf("panelLayout.syncPanelLayout()");
	assert.ok(healIndex > 0, "自愈调用应存在于 AppShell");
	assert.doesNotMatch(source.slice(healIndex), /shouldCommitPanelPixels|saveWidth\(px\)/);
	assert.match(source, /useWorkbenchPanelResize\(/);
});
