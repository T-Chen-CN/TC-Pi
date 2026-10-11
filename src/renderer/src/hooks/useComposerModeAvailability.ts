import { useCallback, useEffect, useState } from "react";
import type { AgentBackend, ComposerAgentMode } from "../../../shared/types";
import { desktopApi } from "../desktopApi";

export const MODE_ORDER: ComposerAgentMode[] = ["normal", "goal", "plan"];

export function computeVisibleModes(options: { planModeAvailable: boolean; goalModeAvailable: boolean }): ComposerAgentMode[] {
	return MODE_ORDER.filter((mode) => {
		if (mode === "plan") return options.planModeAvailable;
		if (mode === "goal") return options.goalModeAvailable;
		return true;
	});
}

export function useComposerModeAvailability(props: { backend?: AgentBackend; value: ComposerAgentMode; disabled?: boolean; onChange: (mode: ComposerAgentMode) => void }) {
	const unsupportedBackend = Boolean(props.backend && props.backend !== "pi");
	const [planModeAvailable, setPlanModeAvailable] = useState(true);
	const [goalModeAvailable, setGoalModeAvailable] = useState(true);

	const refreshAvailability = useCallback(async () => {
		if (unsupportedBackend) {
			setPlanModeAvailable(false);
			setGoalModeAvailable(false);
			return;
		}
		try {
			const result = await desktopApi.extensions.list();
			const plan = result.extensions.find((extension) => extension.source === "pi-deck-plan-mode.ts");
			const goal = result.extensions.find((extension) => extension.source === "pi-deck-goal-mode.ts");
			setPlanModeAvailable(plan?.enabled !== false);
			setGoalModeAvailable(goal?.enabled !== false);
		} catch {
			// 扩展列表读取失败时保守处理：两个模式都按不可用对待，避免用户选了却无扩展响应。
			setPlanModeAvailable(false);
			setGoalModeAvailable(false);
		}
	}, [unsupportedBackend]);

	// 打开菜单时刷新（扩展开关可能刚在设置页改过）。不可用且当前正在用则强制回退，
	// 这属于模式状态流转的边界：不在这里回退，用户会卡在一个扩展已删的模式上。
	useEffect(() => {
		if (!planModeAvailable && props.value === "plan") props.onChange("normal");
		if (!goalModeAvailable && props.value === "goal") props.onChange("normal");
	}, [goalModeAvailable, planModeAvailable, props.onChange, props.value]);

	const visibleModes = computeVisibleModes({
		planModeAvailable,
		goalModeAvailable,
	});

	return { visibleModes, refreshAvailability };
}
