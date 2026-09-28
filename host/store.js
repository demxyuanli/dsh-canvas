/** Content-addressed module store with an LRU bound. Immutable bodies, keyed by sha. */

export class ModuleStore {
  constructor(maxEntries = 64, maxBytes = 32 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.entries = new Map();
  }

  get(sha) {
    const hit = this.entries.get(sha);
    if (hit === undefined) return undefined;
    this.entries.delete(sha);
    this.entries.set(sha, hit);
    return hit;
  }

  put(sha, body) {
    const existing = this.entries.get(sha);
    if (existing !== undefined) this.bytes -= existing.length;
    this.entries.set(sha, body);
    this.bytes += body.length;
    while (this.entries.size > this.maxEntries || (this.bytes > this.maxBytes && this.entries.size > 1)) {
      const oldest = this.entries.keys().next().value;
      const gone = this.entries.get(oldest);
      this.entries.delete(oldest);
      this.bytes -= gone.length;
    }
  }

  stats() {
    return { entries: this.entries.size, bytes: this.bytes, maxEntries: this.maxEntries, maxBytes: this.maxBytes };
  }
}
