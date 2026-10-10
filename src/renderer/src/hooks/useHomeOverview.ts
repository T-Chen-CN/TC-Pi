import { useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { desktopApi } from "../desktopApi";
import { homeOverviewAtom } from "../atoms/home-overview-atoms";
import { overviewProviders } from "../components/home/homeOverviewModel";

/** 主界面可见时读取聚合统计；退回工作区后注销订阅，迟到请求不覆盖快照。 */
export function useHomeOverview(enabled: boolean) {
	const setOverview = useSetAtom(homeOverviewAtom);
	const generation = useRef(0);
	const busy = useRef(false);
	const refresh = useCallback(async () => {
		if (!enabled || busy.current) return;
		busy.current = true;
		const request = generation.current;
		setOverview((current) => ({ ...current, loading: true }));
		try {
			const [usage, models, auth, settings] = await Promise.allSettled([
				(async () => {
					const detect = await desktopApi.usageStats.detect();
					if (!detect.installed) return undefined;
					await desktopApi.usageStats.refresh();
					return desktopApi.usageStats.get();
				})(),
				desktopApi.config.getModels(),
				desktopApi.config.getAuth(),
				desktopApi.config.getSettings(),
			]);
			if (request !== generation.current) return;
			const config = settings.status === "fulfilled" ? settings.value.parsed : {};
			setOverview({
				loading: false,
				usage: usage.status === "fulfilled" ? usage.value : undefined,
				usageMissing: usage.status === "fulfilled" && !usage.value,
				usageError: usage.status === "rejected",
				configError: models.status === "rejected" || auth.status === "rejected" || settings.status === "rejected",
				providers: overviewProviders(models.status === "fulfilled" ? models.value.parsed.providers : {}, auth.status === "fulfilled" ? auth.value.parsed : {}),
				defaultModel: typeof config.defaultModel === "string" ? `${typeof config.defaultProvider === "string" ? `${config.defaultProvider}/` : ""}${config.defaultModel}` : undefined,
			});
		} catch {
			if (request === generation.current) setOverview((current) => ({ ...current, loading: false, usageError: true, configError: true }));
		} finally {
			if (request === generation.current) busy.current = false;
		}
	}, [enabled, setOverview]);
	useEffect(() => {
		generation.current += 1;
		busy.current = false;
		if (!enabled) return;
		const run = () => {
			if (!document.hidden) void refresh();
		};
		run();
		const timer = window.setInterval(run, 60_000);
		window.addEventListener("focus", run);
		return () => {
			generation.current += 1;
			busy.current = false;
			window.clearInterval(timer);
			window.removeEventListener("focus", run);
		};
	}, [enabled, refresh, setOverview]);
	return refresh;
}
