import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const passthrough = ({ children }) => children;
const hidden = () => null;

/** Render the real about content while replacing portals and animated canvases for SSR. */
function renderAbout(legacyVersion) {
	const { AboutPopover } = loadTsCommonJs("src/renderer/src/components/app/AboutPopover.tsx", {
		stubs: {
			"../../desktopApi": { desktopApi: { app: { openExternal() {} } } },
			"../../i18n": { t: (key) => key, formatI18nDateTime: (value) => value },
			"../motion/popover-morph": { MorphPopover: passthrough, MorphPopoverContent: passthrough, MorphPopoverTrigger: passthrough },
			"../motion/animated-badge": { AnimatedBadge: passthrough },
			"./PiLogoCanvas": { PiLogoCanvas: hidden },
			"./PiTuiLogo": { PiTuiLogoCanvas: hidden, useLogoStyle: () => "pi-tui" },
			"../ui-shadcn/button": { Button: ({ children }) => createElement("button", null, children) },
			"./settings/ChangelogDialog": { ChangelogDialog: hidden },
		},
	});
	const appInfo = {
		version: "0.9.0",
		releasesUrl: "https://github.com/ayuayue/PiDeck/releases",
		platform: "win32",
		homeDir: "C:/Users/test",
		userDataDir: "C:/Users/test/AppData/Roaming/pi-desktop-dev",
		piVersion: "1.1.0",
		piAiVersion: "1.0.4",
		...(legacyVersion ? { dshRuntimeVersion: legacyVersion } : {}),
	};
	return renderToStaticMarkup(createElement(AboutPopover, { appInfo }, createElement("button", null, "PiDeck")));
}

for (const legacyVersion of [undefined, "0.8.0"]) {
	test(`about content omits the retired runtime even with legacy version ${legacyVersion ?? "absent"}`, () => {
		const html = renderAbout(legacyVersion);
		assert.doesNotMatch(html, /about\.dshVersion|DSH|0\.8\.0/);
		assert.match(html, /Pi CLI/);
		assert.match(html, /1\.1\.0/);
		assert.match(html, /about\.piAiVersion/);
		assert.match(html, /1\.0\.4/);
	});
}
