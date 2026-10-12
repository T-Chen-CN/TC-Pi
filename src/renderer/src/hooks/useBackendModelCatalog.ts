import { useCallback, useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import type { AgentBackend, AvailableModel, ModelListReport } from "../../../shared/types";
import { desktopApi } from "../desktopApi";
import { showNotice } from "../utils/notice";
import { backendModelCatalogAtomFamily } from "../atoms/backendModelCatalogAtoms";

/**
 * 后端模型目录数据源（C19）：统一「按 backend 加载模型列表」——
 *（诊断报告：优先 pi --list-models，失败回退本地 models.json，并附带失败原因分类）。
 * enabled=false 时不加载（选择器打开才拉取，避免常驻轮询）；
 * 同作用域共享 Jotai 快照与请求代次；选择器刷新后底栏不能用旧目录判死刚选的模型。
 *
 * reload(force=true) = 手动刷新：绕过全局缓存重新 fork pi --list-models，
 * 「模型列表加载不出来」的用户可立即重试，不必重启应用。
 *
 * loading = 首次加载（非手动刷新）在途：选择器据此显示加载态，避免首屏空白。
 */
export function useBackendModelCatalog(options: { sessionId: string; backend?: AgentBackend; projectId?: string; enabled: boolean }): {
	models: AvailableModel[];

	report: ModelListReport | null;
	/** 首次加载在途（手动刷新走 refreshing，两者互斥展示） */
	loading: boolean;
	/** 手动刷新进行中（选择器刷新按钮转圈用） */
	refreshing: boolean;
	/** 重新加载；传 true 绕过缓存强制重新 fork（手动刷新） */
	reload: (force?: boolean) => void;
} {
	const store = useStore();
	const catalogAtom = backendModelCatalogAtomFamily(JSON.stringify([options.backend ?? "pi", options.projectId ?? null]));
	const catalog = useAtomValue(catalogAtom);

	const load = useCallback(
		(force = false) => {
			if (!options.enabled || (options.backend && options.backend !== "pi")) return;
			const current = store.get(catalogAtom);
			// Mounting another consumer cannot supersede a pending manual refresh.
			if (!force && (current.loading || current.refreshing)) return;
			const generation = current.generation + 1;
			store.set(catalogAtom, { ...current, generation, loading: !force, refreshing: force });
			const loader = desktopApi.projects.listModelsReport(options.projectId, force);
			void loader
				.then((next) => {
					if (generation !== store.get(catalogAtom).generation) return;
					store.set(catalogAtom, { generation, models: next.models, report: next, loading: false, refreshing: false });
				})
				.catch((error) => {
					if (generation !== store.get(catalogAtom).generation) return;
					// IPC 异常兜底：列表置空 + 合成失败报告（选择器据此显示失败引导与重试按钮，
					// 而不是把 report 留成 null 导致面板空白），并 toast 提示错误。
					// 原样展示会把 "Error invoking remote method ..." 漏给用户：toast 映射成 i18n 文案，
					// report 用专用失败原因（选择器引导「启动 host」而非「检查 pi 健康」；detail 留空，
					// 引导块已按 reason 出文案，pre 里再放 sentinel 等于没修）。
					const rawDetail = error instanceof Error ? error.message : String(error);
					store.set(catalogAtom, {
						generation,
						models: [],
						loading: false,
						refreshing: false,
						report: {
							models: [],
							ok: false,
							reason: "cli-failed",
							version: null,
							detail: rawDetail,
							source: "none",
							at: Date.now(),
						},
					});
					showNotice(rawDetail, 4000);
				});
		},
		[options.enabled, options.backend, options.projectId, store, catalogAtom],
	);

	useEffect(() => {
		load();
	}, [load]);

	return { models: catalog.models, report: catalog.report, loading: catalog.loading, refreshing: catalog.refreshing, reload: load };
}
