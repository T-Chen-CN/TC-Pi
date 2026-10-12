import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileSearchResult } from "../../../shared/types";
import { filterSnapshotResults } from "../utils/fileSearchFilter";

/**
 * 工作区文件搜索（issue #215）的渲染层状态域：
 * 拥有查询词、防抖调度、代次防竞态、与最近一次完整请求的快照。
 * UI 只消费返回值并转发输入事件，不持有搜索状态。
 */
export const FILE_SEARCH_DEBOUNCE_MS = 250;

export function useFileSearch(options: { projectId?: string; search?: (query: string) => Promise<FileSearchResult[]> }) {
	const { projectId, search } = options;
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<FileSearchResult[] | null>(null);
	const [isSearching, setIsSearching] = useState(false);
	// 代次计数：每次新请求递增；旧请求返回时因代次不匹配被丢弃，
	// 防止慢扫描（主进程最长可跑 8s）覆盖新结果（同 #159 files:list 的防竞态思路）。
	const requestSeqRef = useRef(0);
	// 「最近一次非空查询的完整结果」快照：只在查询变长时更新。
	// 查询被删短后新结果集必然是快照的子集，可先在前端过滤即时反馈，防抖结束才可能再打 IPC。
	const lastGoodRef = useRef<{ query: string; results: FileSearchResult[] } | null>(null);

	const searchNow = useCallback(
		async (rawQuery: string) => {
			const trimmed = rawQuery.trim();
			if (trimmed.length === 0) {
				// 空查询 = 退出搜索态：清结果、放快照，避免下次搜索还命中过期引用
				requestSeqRef.current += 1;
				lastGoodRef.current = null;
				setResults(null);
				setIsSearching(false);
				return;
			}
			if (!projectId && !search) return;
			const seq = ++requestSeqRef.current;
			setIsSearching(true);
			try {
				const list = search ? await search(trimmed) : projectId ? await window.piDesktop.files.search(projectId, trimmed) : [];
				if (seq !== requestSeqRef.current) return; // 迟到的旧请求：静默丢弃
				setResults(list);
				// 查询变长时快照才更新：保证快照查询恒为当前查询的前缀，前缀过滤才有意义
				const last = lastGoodRef.current;
				if (!last || trimmed.length >= last.query.length) {
					lastGoodRef.current = { query: trimmed, results: list };
				}
			} catch {
				// 主进程错误已在日志侧记录；UI 只需停止 loading，保留上一次结果避免闪空
				if (seq === requestSeqRef.current) setIsSearching(false);
			} finally {
				if (seq === requestSeqRef.current) setIsSearching(false);
			}
		},
		[projectId, search],
	);

	// 防抖：停止输入 250ms 才发起扫描；切项目立即清态（旧项目的查询对新项目无意义）。
	useEffect(() => {
		if (query.trim().length === 0) {
			void searchNow("");
			return;
		}
		if (!projectId && !search) return;
		const timer = setTimeout(() => void searchNow(query), FILE_SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, projectId, search, searchNow]);

	// 卸载时作废在途请求，防止 setState 到已卸载组件
	useEffect(
		() => () => {
			requestSeqRef.current += 1;
		},
		[],
	);

	/**
	 * 展示列表：查询是快照查询的前缀时走前端过滤（零延迟），
	 * 否则用服务端结果；无结果时为 null（UI 显示扫描中/空态）。
	 */
	const displayResults = useMemo<FileSearchResult[] | null>(() => {
		const trimmed = query.trim();
		if (trimmed.length === 0) return null;
		const last = lastGoodRef.current;
		if (last) {
			const filtered = filterSnapshotResults(last, trimmed);
			if (filtered) return filtered;
		}
		return results;
	}, [query, results]);

	/** 清空搜索框并退出搜索态（Esc / 关闭按钮） */
	const clearSearch = useCallback(() => setQuery(""), []);

	return { query, setQuery, results: displayResults, isSearching, clearSearch, searchNow };
}
