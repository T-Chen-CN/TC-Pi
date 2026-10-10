import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { mockPiShim } = loadTsCommonJs("e2e/mockPiShim.ts");
test("Windows mock launcher reads Chinese paths as UTF-8 and forwards RPC arguments", () => {
	const body = mockPiShim("win32", "C:\\Node path\\node.exe", "F:\\项目\\mock-pi.cjs");
	assert.equal(body, '@echo off\r\nchcp 65001 >nul\r\n"C:\\Node path\\node.exe" "F:\\项目\\mock-pi.cjs" %*\r\n');
});
test("Unix mock launchers preserve quoted paths and positional arguments", () => {
	assert.equal(mockPiShim("linux", "/node path/node", "/项目/mock-pi.cjs"), '#!/bin/sh\nexec "/node path/node" "/项目/mock-pi.cjs" "$@"\n');
});
