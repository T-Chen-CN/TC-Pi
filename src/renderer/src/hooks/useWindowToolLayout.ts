import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceDrawerPanel } from "./useWorkspacePanels";

export const DEFAULT_PINNED_DRAWER_PANELS: WorkspaceDrawerPanel[] = ["files", "git"];
export const WINDOW_TOOL_LAYOUT_STORAGE_KEY = "pid:window-tool-layout";
type LayoutStorage = Pick<Storage, "getItem" | "setItem">;
type ToolLayout = {
	drawer: WorkspaceDrawerPanel | null;
	drawerCollapsed: boolean;
	drawerPinnedPanel: WorkspaceDrawerPanel | undefined;
	pinnedPanels: WorkspaceDrawerPanel[];
	browserFullscreen: boolean;
};

/** Only tab preferences are durable: a new window always starts with tools hidden and unpinned. */
function readToolTabs(storage: LayoutStorage | undefined, key: string): WorkspaceDrawerPanel[] | null {
	try {
		const value: unknown = JSON.parse(storage?.getItem(key) ?? "null");
		if (!value || typeof value !== "object") return null;
		const valid = (panel: unknown): panel is WorkspaceDrawerPanel => typeof panel === "string" && ["files", "sessions", "browser", "git", "trajectory", "branchTree", "rewind", "scratchPad"].includes(panel);
		const panel = "panel" in value ? (value.panel === "editor" ? "files" : value.panel) : undefined;
		const panels = "pinnedPanels" in value && Array.isArray(value.pinnedPanels) ? value.pinnedPanels.filter(valid) : "pinned" in value && value.pinned === true && valid(panel) ? [panel] : [];
		return panels.length ? [...new Set(panels)] : null;
	} catch {
		return null;
	}
}

/** Window chrome has one owner; legacy preferences are read only during its initial mount. */
export function useWindowToolLayout(options: { storage?: LayoutStorage; legacyStorageKey?: string; onLeaveGit: () => void }) {
	const latest = useRef(options);
	latest.current = options;
	const [layout, setLayout] = useState<ToolLayout>(() => ({
		drawer: null,
		drawerCollapsed: false,
		drawerPinnedPanel: undefined,
		// An already-known startup workspace may supply legacy tabs, but later hydration/switches cannot.
		pinnedPanels: readToolTabs(options.storage, WINDOW_TOOL_LAYOUT_STORAGE_KEY) ?? (options.legacyStorageKey ? readToolTabs(options.storage, options.legacyStorageKey) : null) ?? [...DEFAULT_PINNED_DRAWER_PANELS],
		browserFullscreen: false,
	}));
	const snapshot = useRef(layout);
	snapshot.current = layout;
	const update = useCallback((patch: Partial<ToolLayout>) => {
		const next = { ...snapshot.current, ...patch };
		snapshot.current = next;
		setLayout(next);
	}, []);
	const persistTabs = useCallback((panels: WorkspaceDrawerPanel[]) => {
		try {
			latest.current.storage?.setItem(WINDOW_TOOL_LAYOUT_STORAGE_KEY, JSON.stringify({ pinnedPanels: panels }));
		} catch {
			// Storage failure must not prevent window-local layout controls from working.
		}
	}, []);
	useEffect(() => {
		// Seed the project-independent cache at mount; never import old open/pin flags or touch old keys.
		persistTabs(snapshot.current.pinnedPanels);
	}, [persistTabs]);

	const drawerRef = useRef(layout.drawer);
	const drawerPinnedRef = useRef(false);
	const drawerPinnedPanelRef = useRef(layout.drawerPinnedPanel);
	drawerRef.current = layout.drawer;
	drawerPinnedPanelRef.current = layout.drawerPinnedPanel;
	drawerPinnedRef.current = Boolean(layout.drawerPinnedPanel && layout.drawer === layout.drawerPinnedPanel);
	const setDrawer = useCallback((drawer: WorkspaceDrawerPanel | null) => update({ drawer }), [update]);
	const setDrawerCollapsed = useCallback((drawerCollapsed: boolean) => update({ drawerCollapsed }), [update]);
	const setBrowserFullscreen = useCallback((browserFullscreen: boolean) => update({ browserFullscreen }), [update]);
	const collapseDrawer = useCallback(() => {
		const current = snapshot.current;
		if (!current.drawerPinnedPanel || current.drawer !== current.drawerPinnedPanel) update({ drawerCollapsed: true });
	}, [update]);
	const expandDrawer = useCallback(() => update({ drawerCollapsed: false }), [update]);
	const toggleDrawerPanelPinned = useCallback(
		(panel: WorkspaceDrawerPanel) => {
			if (panel === "rpcLog") return;
			const current = snapshot.current;
			const wasPinned = current.pinnedPanels.includes(panel);
			const next = wasPinned ? current.pinnedPanels.filter((item) => item !== panel) : [...current.pinnedPanels, panel];
			if (!next.length) return;
			// Removing the active tab closes its view unless the tool area is explicitly pinned.
			const closing = wasPinned && current.drawer === panel && current.drawerPinnedPanel !== panel;
			if (closing) latest.current.onLeaveGit();
			update({ pinnedPanels: next, ...(closing ? { drawer: null } : {}) });
			persistTabs(next);
		},
		[persistTabs, update],
	);
	const toggleDrawerPinned = useCallback(() => {
		const current = snapshot.current;
		if (!current.drawer || current.drawer === "rpcLog") return;
		const willPin = current.drawerPinnedPanel !== current.drawer;
		const next = willPin ? (current.pinnedPanels.includes(current.drawer) ? current.pinnedPanels : [...current.pinnedPanels, current.drawer]) : current.pinnedPanels.filter((panel) => panel !== current.drawer);
		update({ drawerPinnedPanel: willPin ? current.drawer : undefined, pinnedPanels: next.length ? next : current.pinnedPanels });
		persistTabs(next.length ? next : current.pinnedPanels);
	}, [persistTabs, update]);

	return { ...layout, drawerPinned: drawerPinnedRef.current, drawerRef, drawerPinnedRef, drawerPinnedPanelRef, setDrawer, setDrawerCollapsed, setBrowserFullscreen, collapseDrawer, expandDrawer, toggleDrawerPanelPinned, toggleDrawerPinned };
}
