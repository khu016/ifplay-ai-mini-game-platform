// 可复现伪随机数：mulberry32（纯 JS，Node 与浏览器同 seed 同结果）。
// 不使用 Math.random，保证同一 GameSpec + 同一 seed + 同一初始状态 → 同一路径。

export class PRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** 返回 [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    const a = this.state;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) 的整数 */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min));
  }

  /** 按权重采样，返回命中下标；权重和为 0 时返回 -1 */
  weighted(weights: number[]): number {
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i] ?? 0;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  getState(): number {
    return this.state;
  }

  setState(s: number): void {
    this.state = s | 0;
  }
}
