export class FgbCountdown {
  private deadline: number | null = null;
  private countUpSince: number | null = null;
  private previous: number | null = null;

  start(now: number, seconds: number) {
    this.deadline = now + seconds * 1000;
    this.countUpSince = null;
    this.previous = null;
  }

  stop() {
    this.deadline = null;
    this.countUpSince = null;
    this.previous = null;
  }

  countUp(now: number) {
    this.stop();
    this.countUpSince = now;
  }

  tick(now: number, reloadSeconds: number, autoReload: boolean) {
    if (this.deadline !== null && now >= this.deadline && !autoReload) {
      this.countUp(this.deadline);
    }
    if (this.deadline === null) return {
      remaining: null,
      elapsed: this.countUpSince === null ? null : Math.floor(Math.max(0, now - this.countUpSince) / 1000) % 1000,
      beep: null,
    };
    if (now >= this.deadline) {
      const period = reloadSeconds * 1000;
      this.deadline += (Math.floor((now - this.deadline) / period) + 1) * period;
      this.previous = null;
    }
    const remaining = Math.ceil((this.deadline - now) / 1000);
    const beep = remaining !== this.previous && remaining <= 5
      ? remaining === 1 ? "counth" as const : "countl" as const
      : null;
    this.previous = remaining;
    return { remaining, elapsed: null, beep };
  }
}
