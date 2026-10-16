/**
 * Vitest setup — jsdom 26 on Node 26 exposes window.localStorage as a getter
 * that returns undefined, so provide a small in-memory Storage when the
 * native one is missing. The ON01 draft store only needs getItem/setItem/
 * removeItem/clear.
 */

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

const w = globalThis.window as unknown as { localStorage?: Storage } | undefined;
if (w && !w.localStorage) {
  Object.defineProperty(w, "localStorage", {
    configurable: true,
    writable: true,
    value: new MemoryStorage(),
  });
}
