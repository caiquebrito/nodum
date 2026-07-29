import { Parser } from '../base.js';
import { loadGrammar, type LoadedGrammar } from './engine.js';

/**
 * Shared base for tree-sitter-backed parsers. Grammar loading is async
 * (WASM), but `Parser.parse()` itself has to be too for that reason — the
 * parser registry (`parser/index.ts`) stays a synchronous array of eagerly
 * constructed instances (see spec 030's Design). This class is what makes
 * that work: each instance lazily awaits its own grammar-load promise the
 * first time `ensureReady()` is called.
 *
 * No memoization happens here (spec 042) — `loadGrammar()` already does the
 * right thing itself: it memoizes the (genuinely immutable, safe-to-share)
 * `Language`, and hands back a fresh `TSParser` bound to it on every call.
 * An earlier version of this class additionally cached `loadGrammar()`'s
 * whole result — including that first fresh `TSParser` — forever, so every
 * `parse()` call on a given instance reused the same `TSParser`. That was
 * only safe by accident, since `parser.parse()` never yields mid-call; it
 * would have silently corrupted results under any future concurrent-parsing
 * work on the same instance.
 *
 * Because every `ensureReady()` call hands back a fresh `TSParser`, every
 * subclass's `parse()` must call `parser.delete()` once done with it (spec
 * 056) — its WASM-side memory is otherwise never freed. A real ~21,000-file
 * sync leaking one `TSParser` per file was the confirmed cause of a real
 * V8 out-of-memory crash at that scale.
 */
export abstract class TreeSitterParser extends Parser {
  /** The `tree-sitter-wasms/out/` filename for this language's grammar. */
  protected abstract grammarFile: string;

  protected ensureReady(): Promise<LoadedGrammar> {
    return loadGrammar(this.grammarFile);
  }
}
