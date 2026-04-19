import { type StateStorage } from 'zustand/middleware';

const store = new Map<string, string>();

export const kvStorage: StateStorage = {
  getItem(key: string): string | null {
    return store.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    store.set(key, value);
  },
  removeItem(key: string): void {
    store.delete(key);
  },
};

export function clearKvStorage(): void {
  store.clear();
}
