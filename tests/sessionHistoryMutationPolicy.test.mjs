import assert from "node:assert/strict";
import test from "node:test";

import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const policy = loadTsCommonJs("src/renderer/src/utils/sessionHistoryMutationPolicy.ts");

test("fork send failure notice never claims failure for accepted or unknown delivery", () => {
	assert.equal(policy.shouldShowResendRollbackHint(false), true);
	assert.equal(policy.shouldShowResendRollbackHint(true), false);
	assert.equal(policy.shouldShowResendRollbackHint("unknown"), false);
});

test("removed backends cannot mutate or resend history, even without a file", () => {
	for (const kind of ["edit", "delete", "resend"]) {
		for (const persisted of [false, true]) {
			assert.equal(policy.resolveHistoryMutationPath({ kind, live: false, persisted, unsupportedBackend: true }).path, "unsupported-backend");
		}
	}
});

// vm realm 构造的对象原型与本 realm 不同，deepEqual 会误判 → 走 JSON 归一化比较
function resolve(kind, options) {
	return policy.resolveHistoryMutationPath({ kind, live: true, ...options });
}
function expectPath(actual, expected) {
	assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

test("persisted pi session edit/resend: fork-mutation (activate only when cold)", () => {
	// fork 化重试：fork 到该消息 entry → 立即以原文/新文本重发；live 会话无需先停
	// （pi fork 会中断当前运行），冷会话先激活（standby 池摊薄成本）。
	expectPath(resolve("edit", { persisted: true }), { path: "fork-mutation", activate: false });
	expectPath(resolve("resend", { persisted: true }), { path: "fork-mutation", activate: false });
	expectPath(resolve("edit", { live: false, persisted: true }), { path: "fork-mutation", activate: true });
	expectPath(resolve("resend", { live: false, persisted: true }), { path: "fork-mutation", activate: true });
});

test("persisted session delete: catalog path regardless of live state (no fork semantics)", () => {
	expectPath(resolve("delete", { persisted: true }), { path: "catalog", live: true });
	expectPath(resolve("delete", { live: false, persisted: true }), { path: "catalog", live: false });
});

test("unpersisted first-send session edit/delete: unsupported (no session file to rewrite)", () => {
	// pi 的 editMessage/deleteMessage 都要求 sessionPath（AgentManager 抛
	// "Session not persisted"），运行中也走不通——必须明确告知不支持，而不是
	// 调必然失败的 runtime 命令。
	expectPath(resolve("edit", { persisted: false }), { path: "unsupported-unpersisted", reason: "edit" });
	expectPath(resolve("delete", { persisted: false }), { path: "unsupported-unpersisted", reason: "delete" });
	// 非 live 也一样不支持
	expectPath(resolve("delete", { live: false, persisted: false }), { path: "unsupported-unpersisted", reason: "delete" });
});

test("unpersisted first-send session resend: resubmit original text (no truncation possible)", () => {
	expectPath(resolve("resend", { persisted: false }), { path: "unpersisted-resend" });
	expectPath(resolve("resend", { live: false, persisted: false }), { path: "unpersisted-resend" });
});
