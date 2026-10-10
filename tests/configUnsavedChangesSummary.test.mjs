import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { summarizeConfigUnsavedChanges, formatConfigUnsavedMessage } = loadTsCommonJs("src/renderer/src/config/configUnsavedChangesSummary.ts");
const i18n = loadTsCommonJs("src/renderer/src/i18n.ts");
const configModal = readFileSync("src/renderer/src/ConfigModal.tsx", "utf8");

test("dsh:<nav> 归并到 DSH 后端 + 对应导航名；config:* 归 Pi 侧（完整列表）", () => {
	const summary = summarizeConfigUnsavedChanges(["dsh:models:dsh:llm-pi-ai", "config:auth"]);
	assert.equal(summary.totalCount, 2);
	// 模块经 VM 加载，对象跨 realm，先映射成 [tabKey, itemKey] 原生数组再比较。
	assert.deepEqual(JSON.parse(JSON.stringify(summary.items.map((i) => [i.tabKey, i.itemKey]))), [
		["config.backend.dsh", "config.dsh.tab.models"],
		["config.backend.pi", "config.nav.auth"],
	]);
});

test("多个 dsh:<nav> 同导航去重，只留一条", () => {
	const summary = summarizeConfigUnsavedChanges(["dsh:models:dsh:llm-pi-ai", "dsh:models:dsh:llm-other", "dsh:plugins:x"]);
	assert.equal(summary.totalCount, 2);
	assert.deepEqual(JSON.parse(JSON.stringify(summary.items.map((item) => item.itemKey))), ["config.dsh.tab.models", "config.dsh.tab.plugins"]);
});

test("聚合 dsh key（无导航段）回退到 DSH 标题而不是崩溃", () => {
	const summary = summarizeConfigUnsavedChanges(["dsh"]);
	assert.equal(summary.totalCount, 1);
	assert.equal(summary.items[0].itemKey, "config.dsh.title");
});

test("无脏标记时返回 null，回退到通用未保存文案", () => {
	assert.equal(summarizeConfigUnsavedChanges([]), null);
	assert.equal(
		formatConfigUnsavedMessage(null, (key) => `#${key}`),
		"#config.unsavedMessage",
	);
});

test("多条脏 tab 时单行兜底文案带计数，插值用单花括号（t() 契约）", () => {
	const zh = String(i18n.exports?.rendererCopy ?? "");
	const summary = summarizeConfigUnsavedChanges(["config:models", "security"]);
	const text = formatConfigUnsavedMessage(summary, (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key));
	assert.match(text, /count/);
	assert.doesNotMatch(zh, /\{\{tab\}\}/);
});

test("装配契约：保存并关闭汇总全部脏来源（不再只存当前 tab）", () => {
	assert.match(configModal, /roots\.add\(key\.startsWith\("dsh:"\) \? "dsh" : key\)/);
	// 保存顺序必须经 orderDirtyKeysForSave：settings 最后保存，否则它的 force 重载
	// 会连带把 models/auth/raw 的未保存草稿冲成磁盘内容（保存并关闭路径同样适用）。
	assert.match(configModal, /for \(const key of orderDirtyKeysForSave\(roots\)\)/);
	assert.doesNotMatch(configModal, /for \(const key of roots\)/);
	assert.match(configModal, /saveByKey\(key\)/);
});
