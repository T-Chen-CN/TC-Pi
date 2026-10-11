import { useCallback, useLayoutEffect, useRef, useState, type RefObject, type PointerEvent, type KeyboardEvent } from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";
import { applyWorkbenchPanelWidths, resizeWorkbenchPanels, type WorkbenchPanelWidths, type WorkbenchResizeTarget } from "../lib/workbenchPanelLayout";
import { LIST_WIDTH_MIN, LIST_WIDTH_MAX } from "./useResize";
import { CONVERSATION_WIDTH_MIN, CONVERSATION_WIDTH_MAX } from "./useConversationPanel";
import { DRAWER_WIDTH_MIN, DRAWER_WIDTH_MIN_PINNED, DRAWER_WIDTH_MAX } from "./useWorkspacePanels";

interface ResizeOptions {
	groupRef: RefObject<GroupImperativeHandle | null>;
	elementRef: RefObject<HTMLDivElement | null>;
	enabled: boolean;
	listCollapsed: boolean;
	drawerOpen: boolean;
	drawerPinned: boolean;
	conversationWidth: number;
	setListWidth: (width: number) => void;
	setDrawerWidth: (width: number) => void;
	saveConversationWidth: (width: number) => void;
}

interface ResizeGesture {
	target: WorkbenchResizeTarget;
	pointerId: number;
	startX: number;
	element: HTMLDivElement;
	initial: WorkbenchPanelWidths;
	next: WorkbenchPanelWidths;
}

/** 拖动拥有快照与指针捕获；只在结束时保存被主动调整的栏，借用宽度不污染偏好。 */
export function useWorkbenchPanelResize(options: ResizeOptions) {
	const latest = useRef(options);
	latest.current = options;
	const gesture = useRef<ResizeGesture | null>(null);
	const pending = useRef<WorkbenchPanelWidths | null>(null);
	const [activeTarget, setActiveTarget] = useState<WorkbenchResizeTarget | null>(null);
	const [listDragWidth, setListDragWidth] = useState<number | null>(null);
	const [drawerLayoutWidth, setDrawerLayoutWidth] = useState<number | null>(null);

	const readWidths = useCallback((): WorkbenchPanelWidths | null => {
		const { groupRef, elementRef } = latest.current;
		const group = groupRef.current;
		const element = elementRef.current;
		if (!group || !element) return null;
		const layout = group.getLayout();
		// 内层 DOM 与鼠标 clientX 同属 CSS 像素，不能使用受 Electron zoom 放大的 inPixels。
		const panelPixels = Array.from(element.children)
			.filter((child) => child.hasAttribute("data-panel"))
			.map((child) => child.getBoundingClientRect().width);
		if (panelPixels.length !== 4 || ![layout.list, layout.files, layout.conversation, layout.drawer].every(Number.isFinite)) return null;
		return { list: panelPixels[0], files: panelPixels[1], conversation: panelPixels[2], drawer: panelPixels[3] };
	}, []);

	const apply = useCallback((widths: WorkbenchPanelWidths) => {
		const group = latest.current.groupRef.current;
		if (!group) return;
		const budget = widths.list + widths.files + widths.conversation + widths.drawer;
		group.setLayout(applyWorkbenchPanelWidths(group.getLayout(), budget, widths));
	}, []);

	const calculate = useCallback((initial: WorkbenchPanelWidths, target: WorkbenchResizeTarget, delta: number) => {
		const current = latest.current;
		return resizeWorkbenchPanels(initial, target, delta, {
			listMinimum: LIST_WIDTH_MIN,
			listMaximum: LIST_WIDTH_MAX,
			conversationMinimum: CONVERSATION_WIDTH_MIN,
			conversationMaximum: CONVERSATION_WIDTH_MAX,
			drawerMinimum: current.drawerPinned ? DRAWER_WIDTH_MIN_PINNED : DRAWER_WIDTH_MIN,
			drawerMaximum: DRAWER_WIDTH_MAX,
			conversationPreferred: current.conversationWidth,
		});
	}, []);

	const commit = useCallback((target: WorkbenchResizeTarget, widths: WorkbenchPanelWidths) => {
		const current = latest.current;
		// 开合时工具可能被限宽；其他分隔线仍须保住其实际宽度，而非突然恢复保存值。
		setDrawerLayoutWidth(widths.drawer);
		if (target === "list") current.setListWidth(Math.round(widths.list));
		else if (target === "conversation") current.saveConversationWidth(Math.round(widths.conversation));
		else current.setDrawerWidth(Math.round(widths.drawer));
	}, []);

	const finish = useCallback(
		(save: boolean) => {
			const current = gesture.current;
			if (!current) return;
			gesture.current = null;
			pending.current = null;
			if (save) commit(current.target, current.next);
			else apply(current.initial);
			setListDragWidth(null);
			setActiveTarget(null);
			if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
		},
		[apply, commit],
	);

	// 左栏约束变化先由 Panel 注册，再在父级 layout effect 应用整组宽度；不出现一帧串动。
	useLayoutEffect(() => {
		if (pending.current) apply(pending.current);
	}, [listDragWidth, apply]);

	useLayoutEffect(() => {
		return () => {
			const current = gesture.current;
			gesture.current = null;
			pending.current = null;
			if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
		};
	}, []);

	useLayoutEffect(() => {
		finish(false);
	}, [options.enabled, options.listCollapsed, options.drawerOpen, finish]);
	useLayoutEffect(() => {
		setDrawerLayoutWidth(null);
	}, [options.drawerOpen]);

	const getHandleProps = (target: WorkbenchResizeTarget) => {
		const current = gesture.current?.next ?? readWidths();
		const lower = current ? calculate(current, target, -10000)[target] : 0;
		const upper = current ? calculate(current, target, 10000)[target] : 0;
		return {
			active: activeTarget === target,
			"aria-controls": target,
			"aria-valuenow": Math.round(current?.[target] ?? 0),
			"aria-valuemin": Math.round(Math.min(lower, upper)),
			"aria-valuemax": Math.round(Math.max(lower, upper)),
			disabled: !options.enabled || (target === "list" && options.listCollapsed) || (target === "drawer" && !options.drawerOpen),
			onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
				const current = latest.current;
				if (!current.enabled || (target === "list" && current.listCollapsed) || (target === "drawer" && !current.drawerOpen) || event.button !== 0 || gesture.current) return;
				const initial = readWidths();
				if (!initial) return;
				event.preventDefault();
				event.currentTarget.focus({ preventScroll: true });
				event.currentTarget.setPointerCapture(event.pointerId);
				gesture.current = { target, pointerId: event.pointerId, startX: event.clientX, element: event.currentTarget, initial, next: initial };
				setDrawerLayoutWidth(initial.drawer);
				setActiveTarget(target);
			},
			onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
				const current = gesture.current;
				if (!current || current.pointerId !== event.pointerId) return;
				current.next = calculate(current.initial, current.target, event.clientX - current.startX);
				current.element.setAttribute("aria-valuenow", String(Math.round(current.next[current.target])));
				if (current.target === "list") {
					pending.current = current.next;
					setListDragWidth(current.next.list);
				} else apply(current.next);
			},
			onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
				if (gesture.current?.pointerId === event.pointerId) finish(true);
			},
			onPointerCancel: (event: PointerEvent<HTMLDivElement>) => {
				if (gesture.current?.pointerId === event.pointerId) finish(false);
			},
			onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
				if (gesture.current?.pointerId === event.pointerId) finish(false);
			},
			onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
				if (event.key === "Escape") {
					finish(false);
					return;
				}
				if (event.key === "F6") {
					const handles = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="separator"]:not([aria-disabled="true"])') ?? []);
					const index = handles.indexOf(event.currentTarget);
					if (handles.length) {
						event.preventDefault();
						handles[(index + (event.shiftKey ? handles.length - 1 : 1)) % handles.length].focus();
					}
					return;
				}
				if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || gesture.current) return;
				const current = latest.current;
				if (!current.enabled || (target === "list" && current.listCollapsed) || (target === "drawer" && !current.drawerOpen)) return;
				const initial = readWidths();
				if (!initial) return;
				event.preventDefault();
				const delta = event.key === "Home" ? -10000 : event.key === "End" ? 10000 : (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 40 : 10);
				const next = calculate(initial, target, delta);
				if (target !== "list") apply(next);
				commit(target, next);
			},
		};
	};

	return { getHandleProps, listDragWidth, drawerLayoutWidth };
}
