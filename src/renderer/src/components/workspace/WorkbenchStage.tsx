import { useEffect, useRef, type ReactNode } from "react";
import type { PanelImperativeHandle, Layout, LayoutChangedMeta } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui-shadcn/resizable";
import { BridgeGuiSlot, useBridgeSessionId } from "../bridge/BridgeSlot";
import { SessionRuntimeDock } from "../session/SessionRuntimeDock";
import type { TerminalDockPanelProps } from "../terminal/TerminalDockPanel";
import { FileText } from "lucide-react";
import { t } from "../../i18n";

export type WorkbenchStageProps = {
	contentChrome: ReactNode;
	hasContent: boolean;
	content: ReactNode;
	hasWorkspace: boolean;
	terminal?: TerminalDockPanelProps;
};

/** 文件是中央的固定阅读面；终端面板保持身份，开合不重建编辑器和撤销历史。 */
export function WorkbenchStage(props: WorkbenchStageProps) {
	const terminalPanelRef = useRef<PanelImperativeHandle>(null);
	const terminalElementRef = useRef<HTMLDivElement>(null);
	const bridgeSessionId = useBridgeSessionId();
	const terminal = props.terminal;
	const terminalRef = useRef(terminal);
	terminalRef.current = terminal;
	const visible = Boolean(terminal?.target && (terminal.open || terminal.closing));
	useEffect(() => {
		const panel = terminalPanelRef.current;
		if (!panel) return;
		if (!visible) panel.collapse();
		else panel.resize(terminalRef.current?.collapsed ? 34 : Math.max(120, terminalRef.current?.height ?? 220));
	}, [visible, terminal?.collapsed, terminal?.height]);

	function handleLayoutChanged(_layout: Layout, meta: LayoutChangedMeta) {
		if (!meta.isUserInteraction || !visible) return;
		const px = Math.round(terminalElementRef.current?.getBoundingClientRect().height ?? 0);
		if (px < 1) terminal?.onOpenChange(false);
		else terminal?.onHeightChange(Math.max(120, px));
	}

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-testid="file-workbench">
			{props.contentChrome}
			<ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1" onLayoutChanged={handleLayoutChanged}>
				<ResizablePanel id="file-main" minSize={100} className="min-h-0">
					<div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
						{props.content}
						{!props.hasContent && (
							<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground" data-testid="file-workbench-empty">
								<FileText className="size-10 opacity-40" />
								<p className="text-body">{t(props.hasWorkspace ? "workbench.chooseFile" : "workbench.noWorkspace")}</p>
								<p className="text-caption">{t(props.hasWorkspace ? "workbench.chooseFileHint" : "workbench.noWorkspaceHint")}</p>
							</div>
						)}
						<BridgeGuiSlot sessionId={bridgeSessionId} slot="content.view" className="flex min-h-0 flex-col gap-2 overflow-auto p-2" />
					</div>
				</ResizablePanel>
				<ResizableHandle disabled={!visible || terminal?.collapsed} disableDoubleClick className={visible ? "h-1 shrink-0 bg-border/60 hover:bg-ring" : "hidden"} />
				<ResizablePanel id="file-terminal" panelRef={terminalPanelRef} collapsible collapsedSize={0} minSize={34} maxSize="65%" defaultSize={0} groupResizeBehavior="preserve-pixel-size" className="min-h-0">
					<div ref={terminalElementRef} className="h-full min-h-0" data-testid="file-terminal">
						{terminal && <SessionRuntimeDock key={terminal.ownerKey} {...terminal} mounted={visible} />}
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
