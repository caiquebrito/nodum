/**
 * Shared tree-sitter runtime — one `Parser.init()` per process, one loaded
 * `Language` and one compiled `Query` per grammar, regardless of how many
 * files get parsed or how many parser instances exist. Nothing here is
 * per-file work; it all happens once and is memoized.
 *
 * Pinned to `web-tree-sitter@^0.25.10` deliberately — 0.26.x cannot load
 * `.wasm` grammars built by older tree-sitter-cli (tree-sitter#5171), and
 * `tree-sitter-wasms`' bundled grammars are older-CLI-built. Verified
 * empirically (not just from the changelog) against all four grammars this
 * repo uses before writing any parser code — see spec 030.
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Parser as TSParser, Language, Query } from 'web-tree-sitter';

const require = createRequire(import.meta.url);

let initPromise: Promise<void> | null = null;

function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = TSParser.init();
  }
  return initPromise;
}

const languageCache = new Map<string, Promise<Language>>();

/**
 * Loads (and memoizes) a tree-sitter grammar by its `tree-sitter-wasms/out/`
 * filename, e.g. `"tree-sitter-python.wasm"`. `tree-sitter-wasms` has no
 * `exports` map, so `require.resolve` returns a plain filesystem path — this
 * works under any `moduleResolution` setting, unlike a package subpath
 * *import* (see spec 024, which hit exactly that wall with a different
 * package).
 */
function loadLanguage(grammarFile: string): Promise<Language> {
  let cached = languageCache.get(grammarFile);
  if (!cached) {
    cached = ensureInitialized().then(async () => {
      const wasmPath = require.resolve(`tree-sitter-wasms/out/${grammarFile}`);
      const bytes = await readFile(wasmPath);
      return Language.load(bytes);
    });
    languageCache.set(grammarFile, cached);
  }
  return cached;
}

const queryCache = new Map<string, Query>();

/**
 * Compiles (and memoizes) a `.scm` query against a language. Queries are
 * compiled objects — never recompile one per file; a keyed cache means every
 * parser instance for the same language shares one compiled `Query`.
 */
function getQuery(language: Language, cacheKey: string, source: string): Query {
  let cached = queryCache.get(cacheKey);
  if (!cached) {
    cached = new Query(language, source);
    queryCache.set(cacheKey, cached);
  }
  return cached;
}

export interface LoadedGrammar {
  language: Language;
  parser: TSParser;
}

/**
 * Loads a grammar and returns a ready-to-use `TSParser` bound to it. The
 * `Language` is memoized (see `loadLanguage`); a fresh `TSParser` instance is
 * still cheap and avoids any state leaking between concurrent `parse()`
 * calls on the same language.
 */
export async function loadGrammar(grammarFile: string): Promise<LoadedGrammar> {
  const language = await loadLanguage(grammarFile);
  const parser = new TSParser();
  parser.setLanguage(language);
  return { language, parser };
}

export { Query };
export type { Language };
export type { QueryCapture, QueryMatch, Node as TSNode, Tree as TSTree } from 'web-tree-sitter';
export { getQuery };
