// 回归测试：侧栏 worktree 工作区行的四个行为契约。
// 背景问题：
// 1) 选中某个工作区时整个区块（含会话列表）被压暗——active 只能挂在分支名行上；
// 2) 主工作区没有折叠入口；
// 3) 新建/匿名按钮只在项目行上，worktree 模式下入口不明显——挪到工作区行。
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const workspaceStyles = readFileSync("src/renderer/src/styles/workspace.css", "utf8");
const sidebarContent = readFileSync("src/renderer/src/components/sidebar/SidebarContent.tsx", "utf8");
const sidebarComponents = readFileSync("src/renderer/src/components/sidebar/SidebarComponents.tsx", "utf8");

test("workspace title more-actions keeps safe worktree removal in the menu", () => {
	assert.match(sidebarContent, /const menuProjectWorktreeParent = menuProject\?\.worktreeParentId/);
	// 属性值可能被格式化换行：用 \s* 容忍。
	assert.match(sidebarContent, /onRemoveWorktree=\{\s*menuProjectWorktreeParent/);
	assert.match(sidebarComponents, /onRemoveWorktree\?: \(\) => void/);
	assert.match(sidebarComponents, /onRemoveWorktree \?\? props\.onRemoveProject/);
	assert.match(sidebarComponents, /t\("app\.worktreeRemoveConfirmTitle"\)/);
});
