import type { ParseResult, FileInfo } from '../types.js';

export abstract class Parser {
  abstract language: string;
  abstract extensions: string[];

  /**
   * Async so tree-sitter-backed parsers can lazily await their own
   * grammar-load promise on first call — see spec 030. Parsers that don't
   * need it (the TS compiler API, or any parser still on regex) just
   * declare `async parse()` with no internal `await`; that's a valid,
   * zero-cost way to satisfy this signature.
   */
  abstract parse(file: FileInfo): Promise<ParseResult>;

  supports(ext: string): boolean {
    return this.extensions.includes(ext.toLowerCase());
  }

  /**
   * Resolves a raw import specifier (as returned in `ParseResult.imports`)
   * to zero or more known file-node ids. Optional — a parser that doesn't
   * extract imports, or whose specifiers can't be resolved without
   * project-wide knowledge some other way, simply omits this.
   *
   * Called once per specifier from `graph-gen.ts`'s `resolveImportsInto`,
   * only after every file in the project is known — a single-file `parse()`
   * call has no visibility into the rest of the project, which is why this
   * is a separate method rather than something `parse()` does itself.
   */
  resolveImport?(
    specifier: string,
    importingFilePath: string,
    knownFileIds: Set<string>,
    knownFilesByPath: Map<string, string>,
  ): string[];

  /**
   * Directory names this parser's language ecosystem conventionally
   * generates (e.g. Python's `__pycache__`) — merged with the cross-cutting
   * base set in `file-discovery.ts`'s `IGNORED_DIRS`. Optional; most
   * parsers have nothing language-specific to add.
   */
  ignoredDirs?: string[];
}
