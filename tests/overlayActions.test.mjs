import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/** Minimal React harness; production dependencies resolve through the shared TS loader. */
function harness() {
	const states = [];
	let cursor = 0;
	const responses = [];
	const react = {
		useState(initial) {
			const index = cursor++;
			if (!(index in states)) states[index] = initial;
			return [
				states[index],
				(next) => {
					states[index] = next;
				},
			];
		},
		useCallback: (fn) => fn,
		useMemo: (factory) => factory(),
	};
	const { useOverlayActions } = loadTsCommonJs("src/renderer/src/hooks/useOverlayActions.ts", {
		stubs: { react, "../desktopApi": { desktopApi: { projects: { respondTrustRequest: (...args) => responses.push(args) } } } },
	});
	return {
		render() {
			cursor = 0;
			return useOverlayActions();
		},
		responses,
	};
}

test("confirmation and trust start closed with no issue feedback state", () => {
	const result = harness().render();
	assert.equal(result.confirmDialog, null);
	assert.equal(result.trustRequest, null);
	assert.equal(result.overlayProps.confirm, undefined);
	assert.equal(result.overlayProps.trust, undefined);
	assert.equal("feedback" in result.overlayProps, false);
	assert.equal("setFeedbackOpen" in result, false);
});

test("confirmation forwards the full configuration and original callback", () => {
	const h = harness();
	const onConfirm = () => undefined;
	const config = { title: "Delete?", message: "Confirm delete", onConfirm, danger: true, confirmLabel: "Delete" };
	h.render().showConfirm(config);
	const result = h.render();
	assert.equal(result.confirmDialog, config);
	assert.equal(result.overlayProps.confirm.open, true);
	for (const [key, value] of Object.entries(config)) assert.equal(result.overlayProps.confirm.props[key], value);
});

test("clearConfirm removes the dialog and its overlay", () => {
	const h = harness();
	h.render().showConfirm({ title: "X", message: "Y", onConfirm: () => undefined });
	assert.equal(h.render().overlayProps.confirm.open, true);
	h.render().clearConfirm();
	assert.equal(h.render().confirmDialog, null);
	assert.equal(h.render().overlayProps.confirm, undefined);
});

test("confirmation cancellation clears the dialog", () => {
	const h = harness();
	h.render().showConfirm({ title: "X", message: "Y", onConfirm: () => undefined });
	h.render().overlayProps.confirm.props.onCancel();
	assert.equal(h.render().overlayProps.confirm, undefined);
});

test("workspace trust forwards request identity and project details", () => {
	const h = harness();
	const request = { requestId: "r1", cwd: "/tmp/project", projectName: "Project" };
	h.render().setTrustRequest(request);
	const result = h.render();
	assert.equal(result.trustRequest, request);
	assert.equal(result.overlayProps.trust.open, true);
	for (const [key, value] of Object.entries(request)) assert.equal(result.overlayProps.trust[key], value);
});

for (const choice of ["trust-remember", "trust-session", "deny"]) {
	test(`workspace trust ${choice} sends the response and closes the dialog`, () => {
		const h = harness();
		h.render().setTrustRequest({ requestId: "r1", cwd: "/tmp", projectName: "Project" });
		h.render().overlayProps.trust.onChoose(choice);
		assert.deepEqual(h.responses, [["r1", choice]]);
		assert.equal(h.render().trustRequest, null);
		assert.equal(h.render().overlayProps.trust, undefined);
	});
}

test("confirmation and trust remain independent when both are open", () => {
	const h = harness();
	const initial = h.render();
	initial.showConfirm({ title: "Delete?", message: "Confirm", onConfirm: () => undefined });
	initial.setTrustRequest({ requestId: "r1", cwd: "/tmp", projectName: "Project" });
	assert.equal(h.render().overlayProps.confirm.open, true);
	assert.equal(h.render().overlayProps.trust.open, true);
	h.render().clearConfirm();
	assert.equal(h.render().overlayProps.confirm, undefined);
	assert.equal(h.render().overlayProps.trust.open, true);
});
