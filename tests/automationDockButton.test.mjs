import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/** Inspect the public rendered button and click port without mounting the entire desktop. */
function renderButton(runs) {
	let openCount = 0;
	const element = (type, props) => ({ type, props });
	const { AutomationDockButton } = loadTsCommonJs("src/renderer/src/components/automation/AutomationDockButton.tsx", {
		stubs: {
			"react/jsx-runtime": { jsx: element, jsxs: element },
			jotai: {
				useAtomValue: () => runs,
				useSetAtom: () => () => {
					openCount++;
				},
			},
			"../../atoms/automation-atoms": { openAutomationModalAtom: {}, automationActiveRunsAtom: {} },
			"../../i18n": { t: () => "Scheduled tasks" },
			"lucide-react": { ListTodo: "ListTodo" },
			"../ui-shadcn/button": { Button: "Button" },
			"../ui-shadcn/tooltip": { Tooltip: "Tooltip", TooltipContent: "TooltipContent", TooltipTrigger: "TooltipTrigger" },
		},
	});
	const tree = AutomationDockButton();
	const [trigger, tooltip] = tree.props.children;
	return { button: trigger.props.children, tooltip, opened: () => openCount };
}

test("idle task icon opens the existing manager and has no active badge", () => {
	const h = renderButton([]);
	assert.equal(h.button.props["aria-label"], "Scheduled tasks");
	assert.equal(h.tooltip.props.children, "Scheduled tasks");
	assert.equal(h.button.props.children[0].type, "ListTodo");
	assert.equal(h.button.props.children[1], false);
	h.button.props.onClick();
	assert.equal(h.opened(), 1);
});

test("active task icon announces the count and displays an indicator", () => {
	const h = renderButton([{}, {}]);
	assert.equal(h.button.props["aria-label"], "Scheduled tasks (2)");
	assert.equal(h.tooltip.props.children, "Scheduled tasks (2)");
	assert.equal(h.button.props.children[1].props["aria-hidden"], "true");
	h.button.props.onClick();
	assert.equal(h.opened(), 1);
});
