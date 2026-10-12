import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { AvailableModel, ModelListReport } from "../../../shared/types";

export type BackendModelCatalogState = {
	models: AvailableModel[];
	report: ModelListReport | null;
	loading: boolean;
	refreshing: boolean;
	generation: number;
};

/** Catalog identity is backend + project scope; picker and composer must validate against one snapshot. */
export const backendModelCatalogAtomFamily = atomFamily((_scopeKey: string) => atom<BackendModelCatalogState>({ models: [], report: null, loading: false, refreshing: false, generation: 0 }));
