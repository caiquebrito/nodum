/**
 * Minimal ASCII progress bar for long-running CLI steps.
 * Redraws in place using a carriage return and only repaints when the
 * percentage changes, so it stays quiet on fast operations.
 */

export interface ProgressBar {
  update(current: number, total: number): void;
  done(): void;
}

export function makeProgressBar(label: string, width = 24): ProgressBar {
  let lastPct = -1;
  const isTTY = Boolean(process.stdout.isTTY);

  const render = (pct: number): void => {
    const clamped = Math.max(0, Math.min(100, pct));
    const filled = Math.round((clamped / 100) * width);
    const bar = '#'.repeat(filled) + '-'.repeat(width - filled);
    process.stdout.write(`\r  → ${label} [${bar}] ${clamped}%`);
  };

  if (!isTTY) {
    // Piped/redirected (CI logs, files): carriage-return redraws would
    // concatenate onto one line, so emit a single clean line instead.
    let announced = false;
    return {
      update(): void {
        if (!announced) {
          announced = true;
          process.stdout.write(`  → ${label}...\n`);
        }
      },
      done(): void {
        if (!announced) process.stdout.write(`  → ${label}...\n`);
      },
    };
  }

  return {
    update(current: number, total: number): void {
      const pct = total > 0 ? Math.round((current / total) * 100) : 100;
      if (pct === lastPct) return;
      lastPct = pct;
      render(pct);
    },
    done(): void {
      // Guarantee a completed bar even if no updates landed (e.g. empty graph).
      render(100);
      process.stdout.write('\n');
    },
  };
}
