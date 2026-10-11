import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";
const { sessionStatusDotClass, isSameSessionPath } = loadTsCommonJs("src/renderer/src/agentListDisplay.ts");
test("Pi session status markers keep their state colors", () => {
	assert.equal(sessionStatusDotClass("idle"), "bg-info");
	assert.equal(sessionStatusDotClass("running"), "bg-warning");
	assert.equal(sessionStatusDotClass("error"), "bg-danger");
	assert.equal(sessionStatusDotClass("detached"), undefined);
});
test("session paths compare within their filesystem environment", () => {
	assert.equal(isSameSessionPath("C:/Users/A/session.jsonl", "c:/users/a/session.jsonl"), true);
	assert.equal(isSameSessionPath("/home/A/session.jsonl", "/home/a/session.jsonl", "wsl"), false);
});
