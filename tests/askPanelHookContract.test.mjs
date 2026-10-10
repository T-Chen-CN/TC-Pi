import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/** Source contracts complement behavior tests in askPanelHistory.test.mjs. */
function compile(filePath) {
	const stub = { useAtom: (value) => [value, () => undefined], useAtomValue: (value) => value, useStore: () => ({ get: () => undefined, set: () => undefined }) };
	return loadTsCommonJs(filePath, {
		stubs: {
			react: { useCallback: (fn) => fn },
			jotai: stub,
			"../atoms/ask-panel-atoms": {},
			"../atoms/app-ui-atoms": {},
			"../atoms/session-atoms": {},
			"../atoms/session-selectors": {},
			"../desktopApi": { desktopApi: { sessions: {} } },
			"../i18n": { t: (key) => key },
			"../utils/notice": { showNotice: () => undefined },
		},
	});
}

const askPanelSource = () => readFileSync("src/renderer/src/hooks/useAskPanel.ts", "utf8");
const overlaySource = () => readFileSync("src/renderer/src/components/overlays/AskPanelOverlay.tsx", "utf8");
const contextSource = () => readFileSync("src/renderer/src/utils/askPanelContext.ts", "utf8");
const atomsSource = () => readFileSync("src/renderer/src/atoms/ask-panel-atoms.ts", "utf8");

test("context is injected via agentMessage so UI timeline only shows user text", () => {
	const source = askPanelSource();
	assert.match(source, /agentMessage: `\$\{context\}\\n\\n\$\{text\}`/);
	// message 仍是用户原文（胶囊时间线不被上下文污染）
	assert.match(source, /message: text,/);
});

test("sendAsk passes context and originSessionId to the panel", () => {
	const source = askPanelSource();
	// 公共 API：sendToAsk(projectId, text, { context?, originSessionId? })
	assert.match(source, /context\?: string; originSessionId\?: string/);
	assert.match(source, /if \(options\?\.originSessionId\) setOriginSessionId/);
});

test("follow-up reuses the existing saved session without creating a new one", () => {
	const source = askPanelSource();
	// sendFollowUp 直接 dispatchPrompt(sessionId)，不再走 ensureSession/setCreating
	assert.match(source, /const sendFollowUp = useCallback/);
	assert.match(source, /if \(!sessionId\) return false;/);
	assert.match(source, /return dispatchPrompt\(sessionId, trimmed\);/);
});

test("close clears origin session id along with the saved session", () => {
	const source = askPanelSource();
	assert.match(source, /setSessionId\(null\);\n\s*setOriginSessionId\(null\);/);
});

test("overlay exposes copy-answer and insert-to-composer actions", () => {
	const source = overlaySource();
	// 复制答案：汇聚全部 assistant 正文
	assert.match(source, /const fullAnswer = messages/);
	// 链式调用可能被格式化拆到多行（navigator.clipboard 与 .writeText 分行）：容忍换行。
	assert.match(source, /navigator\.clipboard\s*\n?\s*\.writeText\(fullAnswer\)/);
	// 插入主会话 composer：setSessionDraftAtom 追加，不自动发送
	assert.match(source, /setInsertComposer\(\{/);
	assert.match(source, /sessionId: origin,/);
	assert.match(source, /value: \(current\) => \(current \? `\$\{current\}\\n\\n\$\{fullAnswer\}` : fullAnswer\)/);
});

test("overlay keeps a follow-up composer that reuses the panel session", () => {
	const source = overlaySource();
	assert.match(source, /const submitFollowUp = /);
	assert.match(source, /panel\.sendFollowUp\(text\)\.then/);
	assert.match(source, /if \(ok\) setFollowUpText\(""\)/);
});

test("atoms track the origin session for bring-back-to-main", () => {
	const source = atomsSource();
	assert.match(source, /askPanelOriginSessionIdAtom/);
	// origin 与匿名会话同生命周期：注释明确「关闭弹框即清空」
	assert.match(source, /关闭弹框即清空|cleared when the panel closes/);
});

test("context block module is pure and exported", () => {
	const source = contextSource();
	assert.match(source, /export function buildAskContextBlock/);
});

test("compile smoke: useAskPanel module loads without throwing", () => {
	const loaded = compile("src/renderer/src/hooks/useAskPanel.ts");
	assert.ok(loaded, "module should compile and load");
});
