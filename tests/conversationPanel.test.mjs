import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { parseConversationWidth, CONVERSATION_WIDTH_DEFAULT, CONVERSATION_WIDTH_MIN, CONVERSATION_WIDTH_MAX } = loadTsCommonJs("src/renderer/src/hooks/useConversationPanel.ts", { stubs: { react: {} } });

test("conversation widths use a safe default for invalid saved values", () => {
	for (const value of [undefined, null, "420", NaN, Infinity]) assert.equal(parseConversationWidth(value), CONVERSATION_WIDTH_DEFAULT);
});

test("conversation widths are rounded and clamped to the panel constraints", () => {
	assert.equal(parseConversationWidth(-5), CONVERSATION_WIDTH_MIN);
	assert.equal(parseConversationWidth(9999), CONVERSATION_WIDTH_MAX);
	assert.equal(parseConversationWidth(450.6), 451);
});
