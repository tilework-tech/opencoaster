/** Seeded, allocation-free 32-bit PRNG (sfc32). Identical output on every JS engine. */
export class Prng {
  readonly state = new Uint32Array(4);

  constructor(seed: number) {
    this.seed(seed);
  }

  seed(seed: number): void {
    // splitmix32 expansion of the seed into 4 words.
    let s = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      this.state[i] = (z ^ (z >>> 16)) >>> 0;
    }
    for (let i = 0; i < 15; i++) this.nextU32();
  }

  nextU32(): number {
    const s = this.state;
    const t = (((s[0] + s[1]) >>> 0) + s[3]) >>> 0;
    s[3] = (s[3] + 1) >>> 0;
    s[0] = s[1] ^ (s[1] >>> 9);
    s[1] = (s[2] + (s[2] << 3)) >>> 0;
    s[2] = ((s[2] << 21) | (s[2] >>> 11)) >>> 0;
    s[2] = (s[2] + t) >>> 0;
    return t;
  }

  /** Uniform integer in [0, n). n must be in (0, 2^32]. Uses multiply-shift (negligible bias). */
  int(n: number): number {
    return Math.floor((this.nextU32() / 0x100000000) * n);
  }

  /** True with probability num/den. */
  chance(num: number, den: number): boolean {
    return this.int(den) < num;
  }
}
