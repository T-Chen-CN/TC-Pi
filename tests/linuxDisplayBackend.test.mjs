import assert from "node:assert/strict";
import test from "node:test";
import { createTsSandbox } from "./helpers/createTsSandbox.mjs";

function loadModule(mockProcess = {}) {
	const appendedSwitches = [];
	let disableHardwareAccelerationCalls = 0;
	const load = createTsSandbox({
		globals: { process: { platform: "linux", env: {}, argv: [], ...mockProcess } },
		stubs: {
			electron: {
				app: {
					disableHardwareAcceleration: () => {
						disableHardwareAccelerationCalls++;
					},
					commandLine: { appendSwitch: (name, value) => appendedSwitches.push({ name, value }) },
				},
			},
		},
	});
	return { ...load("src/main/linuxDisplayBackend.ts"), appendedSwitches, getDisableHardwareAccelerationCalls: () => disableHardwareAccelerationCalls };
}

test("uses X11 ozone backend on Linux Wayland when x11 is explicitly requested", () => {
	const { getLinuxDisplayBackendSwitches } = loadModule();

	assert.deepEqual(
		JSON.parse(
			JSON.stringify(
				getLinuxDisplayBackendSwitches({
					platform: "linux",
					env: {
						XDG_SESSION_TYPE: "wayland",
						WAYLAND_DISPLAY: "wayland-0",
						DISPLAY: ":0",
						PIDECK_LINUX_DISPLAY_BACKEND: "x11",
					},
					argv: [],
				}),
			),
		),
		[
			{ name: "ozone-platform", value: "x11" },
			{ name: "log-level", value: "3" },
		],
	);
});

test("does not force X11 by default without an explicit backend (#108)", () => {
	const { getLinuxDisplayBackendSwitches } = loadModule();

	// 未传 backend override（默认未启用宠物）时，即使处于 Wayland + XWayland 环境
	// 也不得强制 ozone-platform=x11，否则主窗口在部分 GNOME/Wayland 环境不可见。
	assert.deepEqual(
		JSON.parse(
			JSON.stringify(
				getLinuxDisplayBackendSwitches({
					platform: "linux",
					env: {
						XDG_SESSION_TYPE: "wayland",
						WAYLAND_DISPLAY: "wayland-0",
						DISPLAY: ":0",
					},
					argv: [],
				}),
			),
		),
		[],
	);
	assert.deepEqual(
		JSON.parse(
			JSON.stringify(
				getLinuxDisplayBackendSwitches({
					platform: "linux",
					env: {
						XDG_SESSION_TYPE: "wayland",
						WAYLAND_DISPLAY: "wayland-0",
						DISPLAY: ":0",
					},
					argv: [],
				}),
			),
		),
		[],
	);
});

test("forces X11  when the backend is explicitly set to x11", () => {
	const { getLinuxDisplayBackendSwitches } = loadModule();

	assert.deepEqual(
		JSON.parse(
			JSON.stringify(
				getLinuxDisplayBackendSwitches({
					platform: "linux",
					env: {
						XDG_SESSION_TYPE: "wayland",
						WAYLAND_DISPLAY: "wayland-0",
						DISPLAY: ":0",
						PIDECK_LINUX_DISPLAY_BACKEND: "x11",
						PIDECK_LINUX_DISPLAY_BACKEND: "x11",
					},
					argv: [],
				}),
			),
		),
		[
			{ name: "ozone-platform", value: "x11" },
			{ name: "log-level", value: "3" },
		],
	);
});

test("does not force X11 when user opts into native Wayland", () => {
	const { getLinuxDisplayBackendSwitches } = loadModule();

	assert.deepEqual(
		JSON.parse(
			JSON.stringify(
				getLinuxDisplayBackendSwitches({
					platform: "linux",
					env: {
						XDG_SESSION_TYPE: "wayland",
						WAYLAND_DISPLAY: "wayland-0",
						DISPLAY: ":0",
						PIDECK_LINUX_DISPLAY_BACKEND: "wayland",
					},
					argv: [],
				}),
			),
		),
		[],
	);
});

test("does not override an explicit ozone platform argument", () => {
	const { getLinuxDisplayBackendSwitches } = loadModule();

	assert.deepEqual(
		JSON.parse(
			JSON.stringify(
				getLinuxDisplayBackendSwitches({
					platform: "linux",
					env: {
						XDG_SESSION_TYPE: "wayland",
						WAYLAND_DISPLAY: "wayland-0",
						DISPLAY: ":0",
						PIDECK_LINUX_DISPLAY_BACKEND: "x11",
					},
					argv: ["pideck", "--ozone-platform=wayland"],
				}),
			),
		),
		[],
	);
});

test("does not force X11 outside Linux", () => {
	const { getLinuxDisplayBackendSwitches } = loadModule();

	assert.deepEqual(
		JSON.parse(
			JSON.stringify(
				getLinuxDisplayBackendSwitches({
					platform: "darwin",
					env: {
						XDG_SESSION_TYPE: "wayland",
						WAYLAND_DISPLAY: "wayland-0",
						DISPLAY: ":0",
						PIDECK_LINUX_DISPLAY_BACKEND: "x11",
					},
					argv: [],
				}),
			),
		),
		[],
	);
});

test("applies the X11 switch to Electron commandLine before app ready", () => {
	const { applyLinuxDisplayBackendWorkaround, appendedSwitches } = loadModule({
		platform: "linux",
		env: {
			XDG_SESSION_TYPE: "wayland",
			WAYLAND_DISPLAY: "wayland-0",
			DISPLAY: ":0",
			PIDECK_LINUX_DISPLAY_BACKEND: "x11",
		},
		argv: ["pideck"],
	});

	applyLinuxDisplayBackendWorkaround();

	assert.deepEqual(appendedSwitches, [
		{ name: "ozone-platform", value: "x11" },
		{ name: "log-level", value: "3" },
	]);
});

test("does not override an explicit Chromium log level", () => {
	const { applyLinuxDisplayBackendWorkaround, appendedSwitches } = loadModule({
		platform: "linux",
		env: {
			XDG_SESSION_TYPE: "wayland",
			WAYLAND_DISPLAY: "wayland-0",
			DISPLAY: ":0",
			PIDECK_LINUX_DISPLAY_BACKEND: "x11",
		},
		argv: ["pideck", "--log-level=2"],
	});

	applyLinuxDisplayBackendWorkaround();

	assert.deepEqual(appendedSwitches, [{ name: "ozone-platform", value: "x11" }]);
});

test("disables hardware acceleration when forcing X11 on Linux Wayland", () => {
	const { applyLinuxDisplayBackendWorkaround, getDisableHardwareAccelerationCalls } = loadModule({
		platform: "linux",
		env: {
			XDG_SESSION_TYPE: "wayland",
			WAYLAND_DISPLAY: "wayland-0",
			DISPLAY: ":0",
			PIDECK_LINUX_DISPLAY_BACKEND: "x11",
		},
		argv: ["pideck"],
	});

	applyLinuxDisplayBackendWorkaround();

	assert.equal(getDisableHardwareAccelerationCalls(), 1);
});

test("keeps hardware acceleration when Linux GPU disable is opted out", () => {
	const { applyLinuxDisplayBackendWorkaround, getDisableHardwareAccelerationCalls } = loadModule({
		platform: "linux",
		env: {
			XDG_SESSION_TYPE: "wayland",
			WAYLAND_DISPLAY: "wayland-0",
			DISPLAY: ":0",
			PIDECK_LINUX_DISPLAY_BACKEND: "x11",
			PIDECK_LINUX_DISABLE_GPU: "0",
		},
		argv: ["pideck"],
	});

	applyLinuxDisplayBackendWorkaround();

	assert.equal(getDisableHardwareAccelerationCalls(), 0);
});

test("applies nothing and keeps GPU acceleration without an explicit backend (#108)", () => {
	const { applyLinuxDisplayBackendWorkaround, appendedSwitches, getDisableHardwareAccelerationCalls } = loadModule({
		platform: "linux",
		env: {
			XDG_SESSION_TYPE: "wayland",
			WAYLAND_DISPLAY: "wayland-0",
			DISPLAY: ":0",
		},
		argv: ["pideck"],
	});

	// 默认（未请求 x11）不得改动任何 Chromium 启动参数。
	applyLinuxDisplayBackendWorkaround();

	assert.deepEqual(appendedSwitches, []);
	assert.equal(getDisableHardwareAccelerationCalls(), 0);
});
