import { useCallback, useRef, useState } from "react";
import type { DragEvent } from "react";
import { PROVIDER_CARD_DRAG_MIME, moveProviderByStep, moveProviderRelative } from "../utils/providerOrder";

/** 当前落点：插到哪个供应商卡片的前/后。 */
export type ProviderDropTarget = { name: string; position: "before" | "after" };

/** 卡片拖拽事件（HTML5 原生 DnD，与仓库既有拖拽一致：不引第三方 dnd 库）。 */
type ProviderCardHandlers = {
	onDragOver: (event: DragEvent<HTMLDivElement>) => void;
	onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
	onDrop: (event: DragEvent<HTMLDivElement>) => void;
};

type ProviderGripHandlers = {
	draggable: true;
	onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
	onDragEnd: () => void;
};

export function useProviderReorder(options: { names: readonly string[]; visibleNames: readonly string[]; onReorder: (nextOrder: string[]) => void }) {
	const { names, visibleNames, onReorder } = options;
	const cardRefs = useRef<Record<string, HTMLElement | null>>({});
	// 拖动源与落点必须用 state：拖动过程要实时渲染半透明卡片与插入指示线。
	const [draggingName, setDraggingName] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<ProviderDropTarget | null>(null);

	/** 卡片容器 ref：落点判定需要读取卡片的实际位置。 */
	const registerCard = useCallback((name: string, element: HTMLDivElement | null) => {
		if (element) cardRefs.current[name] = element;
		else delete cardRefs.current[name];
	}, []);

	/**
	 * 落点判定：以卡片标题行（data-provider-head）的中线为准，指针在上半区→插到该卡之前，下半区→之后。
	 * 展开态卡片很高，拿整张卡的中线会让落点偏到折叠区，所以固定量标题行；
	 * 不能用 firstElementChild：拖拽中卡内会插入绝对定位的指示线 span，会抢到头子元素。
	 * 取不到矩形（列表刚更新、元素未挂载）时退化为「插到之前」，不会抛错。
	 */
	const resolveDropPosition = useCallback((event: DragEvent<HTMLDivElement>, name: string): "before" | "after" => {
		const card = cardRefs.current[name];
		const headRow = card?.querySelector("[data-provider-head]") ?? card?.firstElementChild;
		const rect = (headRow ?? card)?.getBoundingClientRect();
		if (!rect) return "before";
		return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
	}, []);

	const handleDragStart = useCallback((event: DragEvent<HTMLButtonElement>, name: string) => {
		event.dataTransfer.effectAllowed = "move";
		// 自定义 MIME 防止外部拖入的文本/链接被当成本列表内部重排；text/plain 兜底便于调试。
		event.dataTransfer.setData(PROVIDER_CARD_DRAG_MIME, name);
		event.dataTransfer.setData("text/plain", name);
		setDraggingName(name);
	}, []);

	const handleDragEnd = useCallback(() => {
		setDraggingName(null);
		setDropTarget(null);
	}, []);

	const handleDragOver = useCallback(
		(event: DragEvent<HTMLDivElement>, name: string) => {
			// 只接自己发起的拖动：不 preventDefault，浏览器就不会把该位置当合法落点。
			if (!draggingName || draggingName === name) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
			const position = resolveDropPosition(event, name);
			// 仅在落点真正变化时 setState：dragover 每次鼠标移动都触发，不去重会持续重渲染整个列表。
			setDropTarget((prev) => (prev?.name === name && prev.position === position ? prev : { name, position }));
		},
		[draggingName, resolveDropPosition],
	);

	const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>, name: string) => {
		// 拖到卡片内部子元素上也会触发 dragleave，此时 relatedTarget 仍在卡片内，不能清除指示线。
		const related = event.relatedTarget;
		if (related instanceof Node && event.currentTarget.contains(related)) return;
		setDropTarget((prev) => (prev?.name === name ? null : prev));
	}, []);

	const handleDrop = useCallback(
		(event: DragEvent<HTMLDivElement>, name: string) => {
			event.preventDefault();
			const source = draggingName;
			// 松手瞬间 dropTarget 可能还没跟上最后一次 dragover，此时按当前指针位置重算。
			const position = dropTarget?.name === name ? dropTarget.position : resolveDropPosition(event, name);
			setDraggingName(null);
			setDropTarget(null);
			if (!source || source === name) return;
			onReorder(moveProviderRelative(names, source, name, position));
		},
		[draggingName, dropTarget, names, onReorder, resolveDropPosition],
	);

	/** 上移/下移是否可用（到顶/到底返回 false，按钮据此禁用）。 */
	const canMove = useCallback((name: string, delta: -1 | 1) => moveProviderByStep(names, visibleNames, name, delta) !== null, [names, visibleNames]);

	/** 上移/下移：以可见列表里的邻居为锚点在完整顺序上移动。 */
	const moveBy = useCallback(
		(name: string, delta: -1 | 1) => {
			const next = moveProviderByStep(names, visibleNames, name, delta);
			if (next) onReorder(next);
		},
		[names, visibleNames, onReorder],
	);

	const cardProps = useCallback(
		(name: string): ProviderCardHandlers => ({
			onDragOver: (event) => handleDragOver(event, name),
			onDragLeave: (event) => handleDragLeave(event, name),
			onDrop: (event) => handleDrop(event, name),
		}),
		[handleDragOver, handleDragLeave, handleDrop],
	);

	const gripProps = useCallback(
		(name: string): ProviderGripHandlers => ({
			draggable: true,
			onDragStart: (event) => handleDragStart(event, name),
			onDragEnd: handleDragEnd,
		}),
		[handleDragStart, handleDragEnd],
	);

	return { draggingName, dropTarget, registerCard, cardProps, gripProps, canMove, moveBy };
}
