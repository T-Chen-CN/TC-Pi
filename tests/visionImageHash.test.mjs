import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);

// 渲染层源码：用与扩展相同的 transpileModule 编译，取 visionImageHash 与扩展实现比对
const rendererSource = readFileSync("src/renderer/src/utils/visionImageHash.ts", "utf8");
const rendererOutput = ts.transpileModule(rendererSource, {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2022,
		esModuleInterop: true,
	},
	fileName: "visionImageHash.ts",
}).outputText;
const hashModule = { exports: {} };
vm.runInNewContext(rendererOutput, { module: hashModule, exports: hashModule.exports, TextEncoder, crypto }, { filename: "visionImageHash.ts" });
const { visionImageHash } = hashModule.exports;

test("visionImageHash 与 node crypto sha256 前 24 位一致", async () => {
	const data = "vision-bridge-sample";
	const expected = createHash("sha256").update(data).digest("hex").slice(0, 24);
	assert.equal(await visionImageHash(data), expected);
});

test("不同图片产生不同哈希", async () => {
	const a = await visionImageHash("AAAA");
	const b = await visionImageHash("BBBB");
	assert.notEqual(a, b);
});
