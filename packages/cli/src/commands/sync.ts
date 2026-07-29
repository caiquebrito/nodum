import { resolve } from 'path';
import { syncProject as coreSyncProject } from '@caiquebrito/nodum-core';
import { makeProgressBar, type ProgressBar } from '../utils/progress.js';

export async function syncProject(
  projectPath: string,
  nodumDataDir: string,
  options: { incremental?: boolean } = {},
): Promise<void> {
  const absolutePath = resolve(projectPath);
  console.log(`📊 Scanning: ${absolutePath}`);

  try {
    const parseBar = makeProgressBar('Parsing code');
    const clusterBar = makeProgressBar('Generating clusters');
    // Mutable box (not a plain `let`) so TS doesn't over-narrow the type
    // across the closure boundary below to `never`.
    const stepBarRef: { current: ProgressBar | null } = { current: null };

    const graph = await coreSyncProject(projectPath, nodumDataDir, {
      onParseProgress: (processed, total) => parseBar.update(processed, total),
      onClusterProgress: (processed, total) => clusterBar.update(processed, total),
      onStep: (label) => {
        stepBarRef.current?.done();
        stepBarRef.current = makeProgressBar(label);
      },
      onWarning: (message) => console.warn(`⚠️  ${message}`),
      incremental: options.incremental,
    });

    parseBar.done();
    clusterBar.done();
    stepBarRef.current?.done();

    console.log(`\n✅ Synced: ${graph.project}`);
    console.log(`  📁 ${graph.stats.files} files`);
    console.log(`  ⚙️  ${graph.stats.functions} functions`);
    console.log(`  📦 ${graph.stats.classes} classes`);
    console.log(`  🔗 ${graph.stats.edges} dependencies\n`);
    console.log(`Data saved to: ${nodumDataDir}/${graph.project}`);
  } catch (error) {
    const wrapped = new Error(
      `Failed to sync project: ${error instanceof Error ? error.message : String(error)}`,
    );
    // Assigned rather than passed via the ErrorOptions constructor overload,
    // which requires the ES2022.Error lib (repo tsconfig is locked to ES2020).
    (wrapped as Error & { cause?: unknown }).cause = error;
    // Appended directly onto `wrapped.stack` (not just `.cause`) so a plain
    // `console.error(error.stack)` at the CLI's top level shows the real
    // failure site without the caller needing to know to check `.cause`
    // separately — this is what was silently losing the original stack
    // trace before (see the "known issue" a real crash investigation ran
    // into: the wrapper's own message-only `Error` swallowed exactly the
    // stack needed to find which recursive call overflowed).
    if (error instanceof Error && error.stack) {
      wrapped.stack = `${wrapped.stack}\nCaused by: ${error.stack}`;
    }
    throw wrapped;
  }
}
