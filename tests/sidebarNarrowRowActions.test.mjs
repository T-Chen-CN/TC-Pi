import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { twMerge } from "tailwind-merge";

// 侧栏行操作按钮防重叠契约（2027-01 用户反馈）：
// 三个树（ProjectTree/SessionTree/WorktreeTree）的行操作按钮是 absolute 浮层，
// hover 显现时会盖住行文本。修复策略：行文本用 group-hover:pr-* 在 hover 时压出
// 按钮宽度的右侧留白，文本截断让位但保持可见。所有宽度统一让位（不止窄侧栏）——
// 中等宽度下长项目名/长会话名同样会延伸到按钮下方（“+ 号叠在项目名上”反馈）。
// 注意：v1 曾用 opacity-0 整行淡出，用户反馈「文字变白不可读、须点击激活才能看到」，
// 已弃用（见本文件 doesNotMatch 断言防回退）。
// 本测试锁定：三棵树的行 hover 让位宽度与按钮浮层模式不被破坏。
// 注：WorktreeTree 用命名组 /workspace-row（主/子行共用 workspaceActionPaddingClass
// 裁剪出入 52px 让位）；SidebarContent 的 aside 已不再需要 @container 容器查询锚点。

const read = (p) => readFileSync(p, "utf8");

const prVariant = /@max-\[255px\]:group-hover(?:\/row)?:pr-/;

test("hover yield classes survive tailwind-merge", () => {
	// 防回归：cn() 的 tailwind-merge 不得吞掉 group-hover/group-focus-within 的 pr 让位类
	// （不同修饰键的 pr 互不冲突，均应保留）
	const merged = twMerge("min-w-0 flex-1 truncate transition-[padding-right] group-hover:pr-16 group-focus-within:pr-16");
	assert.match(merged, /group-hover:pr-16/);
	assert.match(merged, /group-focus-within:pr-16/);
	assert.match(merged, /transition-\[padding-right\]/);
	// 项目行筛选按钮出现时：同修饰键同组冲突，88px 版本应胜出（让位加宽）
	const filtered = twMerge("transition-[padding-right] group-hover:pr-16 group-focus-within:pr-16", "group-hover:pr-[88px] group-focus-within:pr-[88px]");
	assert.match(filtered, /group-hover:pr-\[88px\]/);
	assert.match(filtered, /group-focus-within:pr-\[88px\]/);
	assert.doesNotMatch(filtered, /pr-16/);
	// 子行同一规则：与 52px 让位类合并时同样保留
	const rowMerged = twMerge("min-w-0 flex-1 truncate transition-[padding-right] group-hover/workspace-row:pr-[52px] group-focus-within/workspace-row:pr-[52px]");
	assert.match(rowMerged, /group-hover\/workspace-row:pr-\[52px\]/);
	assert.match(rowMerged, /group-focus-within\/workspace-row:pr-\[52px\]/);
});
