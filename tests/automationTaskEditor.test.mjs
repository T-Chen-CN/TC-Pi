import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/** Render the actual editor, replacing asynchronous catalogs and popup primitives. */
function renderEditor(backend) {
	const pass = ({ children }) => children;
	const button = ({ children, disabled, type }) => createElement("button", { disabled, type }, children);
	const { AutomationTaskEditor } = loadTsCommonJs("src/renderer/src/components/automation/AutomationTaskEditor.tsx", {
		stubs: {
			jotai: { useAtomValue: () => [] },
			"../../atoms/project-atoms": { projectInventoryAtom: {} },
			"../../desktopApi": { desktopApi: {} },
			"../../hooks/useBackendModelCatalog": { useBackendModelCatalog: () => ({ models: [], reload() {} }) },
			"../../i18n": { t: (key) => key },
			"../../utils/notice": { showNotice() {} },
			"../session/ComposerComponents": { ModelPicker: () => null },
			"./CronScheduleBuilder": { CronScheduleBuilder: () => null },
			"../ui-shadcn/select": { Select: pass, SelectContent: pass, SelectItem: pass, SelectTrigger: pass, SelectValue: () => null },
			"../ui-shadcn/button": { Button: button },
			"../ui-shadcn/input": { Input: ({ value, disabled }) => createElement("input", { value, disabled, readOnly: true }) },
			"../ui-shadcn/label": { Label: pass },
			"../ui-shadcn/textarea": { Textarea: ({ value }) => createElement("textarea", { value, readOnly: true }) },
			"../ui-shadcn/switch": { Switch: ({ disabled }) => createElement("button", { disabled }) },
		},
	});
	const task = { id: "legacy", projectId: "project", name: "Existing", prompt: "Existing prompt", backend, enabled: true, schedule: { type: "cron", expression: "0 9 * * *" }, budget: {}, createdAt: 1, updatedAt: 1 };
	return renderToStaticMarkup(createElement(AutomationTaskEditor, { task, onSave() {}, onCancel() {} }));
}

test("legacy automation is inspectable with disabled fields and save", () => {
	const html = renderEditor("dsh");
	assert.match(html, /automation\.legacyBackendReadOnly/);
	assert.match(html, /<fieldset disabled=""/);
	assert.match(html, /<button disabled="" type="submit">automation\.saveTask/);
	assert.doesNotMatch(html, /task-backend/);
});

test("Pi and default historical tasks keep an editable form", () => {
	for (const backend of ["pi", undefined]) {
		const html = renderEditor(backend);
		assert.doesNotMatch(html, /automation\.legacyBackendReadOnly|<fieldset disabled=/);
	}
});
