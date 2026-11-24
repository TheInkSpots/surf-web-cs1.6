export class StrafeSyncTracker {
  private readonly windowSize: number;
  private readonly ring: Uint8Array;
  private head = 0;
  private count = 0;
  private hits = 0;

  constructor(windowSize = 140) {
    this.windowSize = windowSize;
    this.ring = new Uint8Array(windowSize);
  }

  public recordTick(
    airborne: boolean,
    keyA: boolean,
    keyD: boolean,
    yawDelta: number,
    preXY: number,
    postXY: number,
  ): void {
    const holdingLeft = keyA && !keyD;
    const holdingRight = keyD && !keyA;
    if (!airborne || (!holdingLeft && !holdingRight)) return;

    const yawMatches =
      (holdingLeft && yawDelta > 0.00015) || (holdingRight && yawDelta < -0.00015);
    const hit = yawMatches || postXY > preXY + 0.05 ? 1 : 0;

    if (this.count < this.windowSize) {
      this.count++;
    } else {
      this.hits -= this.ring[this.head];
    }

    this.ring[this.head] = hit;
    this.hits += hit;
    this.head = (this.head + 1) % this.windowSize;
  }

  public getSyncPercent(): number {
    return this.count > 0 ? Math.round((this.hits / this.count) * 100) : 0;
  }

  public reset(): void {
    this.ring.fill(0);
    this.head = 0;
    this.count = 0;
    this.hits = 0;
  }
}
