import { Parser } from './base.js';
import { TypeScriptParser } from './typescript.js';
import { JavaScriptParser } from './javascript.js';
import { PythonParser } from './python.js';
import { KotlinParser } from './kotlin.js';
import { JavaParser } from './java.js';

export { Parser };
export { TypeScriptParser, JavaScriptParser, PythonParser, KotlinParser, JavaParser };

const parsers: Parser[] = [
  new TypeScriptParser(),
  new JavaScriptParser(),
  new PythonParser(),
  new KotlinParser(),
  new JavaParser(),
];

export function selectParser(ext: string): Parser | null {
  const normalized = ext.toLowerCase();
  return parsers.find(p => p.supports(normalized)) || null;
}

export function getAvailableParsers(): Parser[] {
  return parsers;
}
