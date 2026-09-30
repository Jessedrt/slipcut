import { getSetting, setSetting } from "./study";

export type ProviderCacheStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
};
// Fixed slots bound database storage. Each value contains its full request digest
// so collisions are cache misses, never another fixture's evidence.
export const providerCacheStore: ProviderCacheStore = { get: getSetting, set: setSetting };
