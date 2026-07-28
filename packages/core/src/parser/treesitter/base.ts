import { Parser } from '../base.js';
import { loadGrammar, type LoadedGrammar } from './engine.js';

/**
 * Shared base for tree-sitter-backed parsers. Grammar loading is async
 * (WASM), but `Parser.parse()` itself has to be too for that reason — the
 * parser registry (`parser/index.ts`) stays a synchronous array of eagerly
 * constructed instances (see spec 030's Design). This class is what makes
 * that work: each instance lazily awaits its own grammar-load promise the
 * first time `ensureReady()` is called, memoized after that — so
 * constructing a `new PythonParser()` is instant, and only the first
 * `parse()` call on it pays the WASM-load cost.
 */
export abstract class TreeSitterParser extends Parser {
  /** The `tree-sitter-wasms/out/` filename for this language's grammar. */
  protected abstract grammarFile: string;

  private ready: Promise<LoadedGrammar> | null = null;

  protected ensureReady(): Promise<LoadedGrammar> {
    if (!this.ready) {
      this.ready = loadGrammar(this.grammarFile);
    }
    return this.ready;
  }
}
