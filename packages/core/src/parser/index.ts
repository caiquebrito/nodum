import { Parser } from './base.js';
import { TypeScriptParser } from './typescript.js';
import { JavaScriptParser } from './javascript.js';
import { PythonParser } from './python.js';
import { KotlinParser } from './kotlin.js';
import { JavaParser } from './java.js';
import { SwiftParser } from './swift.js';

export { Parser };
export { TypeScriptParser, JavaScriptParser, PythonParser, KotlinParser, JavaParser, SwiftParser };

const parsers: Parser[] = [
  new TypeScriptParser(),
  new JavaScriptParser(),
  new PythonParser(),
  new KotlinParser(),
  new JavaParser(),
  new SwiftParser(),
];

export function selectParser(ext: string): Parser | null {
  const normalized = ext.toLowerCase();
  return parsers.find(p => p.supports(normalized)) || null;
}

export function getAvailableParsers(): Parser[] {
  return parsers;
}

/**
 * Registers an additional parser at runtime, ahead of the built-in ones
 * (`unshift`, not `push`) — so a consumer can override support for an
 * extension the built-in registry already claims, the same way
 * `TypeScriptParser` being first in the array today takes priority over
 * any future `.ts`-capable parser. Making the registry extensible this way
 * is what turns "add a language" into "register a parser" instead of
 * "edit core and republish" — see spec 030.
 */
export function registerParser(parser: Parser): void {
  parsers.unshift(parser);
}
