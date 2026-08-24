import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CutResult } from "./types";

export type HistoryItem = {
  id: string;
  at: number;
  label: string;
  result: CutResult;
};

type HistoryState = {
  items: HistoryItem[];
  push: (item: Omit<HistoryItem, "id" | "at"> & { id?: string }) => void;
  remove: (id: string) => void;
  clear: () => void;
};

export const useHistory = create<HistoryState>()(
  persist(
    (set, get) => ({
      items: [],
      push: (item) => {
        const next: HistoryItem = {
          id: item.id ?? `h-${Date.now()}`,
          at: Date.now(),
          label: item.label,
          result: item.result,
        };
        const items = [next, ...get().items.filter((x) => x.id !== next.id)].slice(0, 12);
        set({ items });
      },
      remove: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
      clear: () => set({ items: [] }),
    }),
    { name: "slipcut-history" },
  ),
);
