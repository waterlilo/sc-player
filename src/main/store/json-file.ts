import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** A small JSON document on disk: read once, written atomically (tmp + rename) and debounced. */
export class JsonFile<T extends object> {
  private data: T;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly path: string,
    defaults: T,
    private readonly delay = 400,
  ) {
    let stored: Partial<T> = {};
    try {
      stored = JSON.parse(readFileSync(path, "utf8")) as Partial<T>;
    } catch {
      /* first run or a damaged file — start from the defaults */
    }
    this.data = { ...defaults, ...stored };
  }

  get(): Readonly<T> {
    return this.data;
  }

  patch(patch: Partial<T>) {
    this.data = { ...this.data, ...patch };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.path);
  }
}
