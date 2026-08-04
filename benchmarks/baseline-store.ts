/**
 * Stores each benchmark run's aggregate under benchmarks/baselines/<version>.json,
 * keyed by the nodum release that produced it (spec 064). Without this, the
 * nightly `benchmark-accuracy.yml` run only ever reports an absolute
 * `tokensPerCorrectAnswer` figure — useless for answering "did this release
 * make things better," since there's nothing to compare it against. Reading
 * back the immediately-preceding version's file turns that into a real
 * before/after delta.
 *
 * Deliberately a flat JSON file per version, not a database — matches this
 * project's existing storage posture (graph.json, metrics.jsonl) and stays
 * committable so the history is visible in `git log` on the file itself.
 */
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { BenchmarkSummary, StoredBaseline } from './datasets/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINES_DIR = join(__dirname, 'baselines');

export function baselineFromSummary(summary: BenchmarkSummary, nodumVersion: string): StoredBaseline {
  return {
    nodumVersion,
    timestamp: summary.timestamp,
    projectName: summary.projectName,
    aggregate: summary.aggregate,
  };
}

export async function writeBaseline(baseline: StoredBaseline, baselinesDir: string = BASELINES_DIR): Promise<string> {
  await mkdir(baselinesDir, { recursive: true });
  const path = join(baselinesDir, `${baseline.nodumVersion}.json`);
  await writeFile(path, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
  return path;
}

/**
 * Simple ascending semver comparator (major.minor.patch, no prerelease
 * handling) — sufficient here since Changesets' `fixed` lockstep group
 * (spec 023) means every nodum version is a plain three-number release.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/**
 * Finds the stored baseline with the highest version strictly less than
 * `currentVersion` — i.e. the most recent prior release's numbers, to diff
 * the current run against. Returns null if no earlier baseline exists yet
 * (e.g. the very first run after this spec lands).
 */
export async function loadPreviousBaseline(
  currentVersion: string,
  baselinesDir: string = BASELINES_DIR,
): Promise<StoredBaseline | null> {
  let files: string[];
  try {
    files = await readdir(baselinesDir);
  } catch {
    return null;
  }

  const versions = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((v) => compareVersions(v, currentVersion) < 0)
    .sort(compareVersions);

  const previousVersion = versions[versions.length - 1];
  if (!previousVersion) return null;

  const raw = await readFile(join(baselinesDir, `${previousVersion}.json`), 'utf-8');
  return JSON.parse(raw);
}

export interface BaselineDelta {
  previousVersion: string;
  tokensPerCorrectAnswerDelta: number; // negative = improved (fewer tokens per correct answer)
  tokensPerCorrectAnswerPercentChange: number;
}

export function diffAgainstBaseline(current: BenchmarkSummary, previous: StoredBaseline): BaselineDelta {
  const delta = current.aggregate.tokensPerCorrectAnswer - previous.aggregate.tokensPerCorrectAnswer;
  const percentChange =
    previous.aggregate.tokensPerCorrectAnswer === 0
      ? 0
      : (delta / previous.aggregate.tokensPerCorrectAnswer) * 100;
  return {
    previousVersion: previous.nodumVersion,
    tokensPerCorrectAnswerDelta: delta,
    tokensPerCorrectAnswerPercentChange: percentChange,
  };
}
