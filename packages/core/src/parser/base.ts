import type { ParseResult, FileInfo } from '../types.js';

export abstract class Parser {
  abstract language: string;
  abstract extensions: string[];

  abstract parse(file: FileInfo): ParseResult;

  supports(ext: string): boolean {
    return this.extensions.includes(ext.toLowerCase());
  }
}
