export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private _count = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  get length(): number { return this._count; }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._count < this.capacity) this._count++;
  }

  get(index: number): T | undefined {
    if (index < 0 || index >= this._count) return undefined;
    const idx = (this.head - this._count + index + this.capacity) % this.capacity;
    return this.buffer[idx];
  }

  last(): T | undefined {
    if (this._count === 0) return undefined;
    return this.buffer[(this.head - 1 + this.capacity) % this.capacity];
  }

  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this._count; i++) result.push(this.get(i)!);
    return result;
  }

  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this._count = 0;
  }
}
