import { diagnostic, type ControlDiagnostic } from "./types.js";

export type JsonRead =
  | { readonly kind: "read"; readonly value: unknown }
  | {
      readonly kind: "invalid";
      readonly diagnostics: readonly ControlDiagnostic[];
    };

export function readStrictJson(bytes: Uint8Array, path: string): JsonRead {
  try {
    if (bytes.byteLength > 8 * 1024 * 1024)
      throw new Error("JSON control exceeds 8 MiB.");
    const source = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    new JsonLexicalCheck(source).check();
    const value: unknown = JSON.parse(source);
    return { kind: "read", value };
  } catch (error) {
    return {
      kind: "invalid",
      diagnostics: [
        diagnostic(
          "invalid-json-bytes",
          path,
          error instanceof Error ? error.message : String(error),
          "Supply UTF-8 JSON with unique keys, Unicode scalar strings and safe integer literals; preserve the refused bytes for review.",
        ),
      ],
    };
  }
}

class JsonLexicalCheck {
  private offset = 0;
  constructor(private readonly source: string) {}

  check(): void {
    this.value(0);
    this.space();
    if (this.offset !== this.source.length)
      this.fail("Unexpected trailing input");
  }

  private value(depth: number): void {
    if (depth > 128) this.fail("JSON nesting exceeds 128");
    this.space();
    const character = this.source[this.offset];
    if (character === '"') {
      this.string();
      return;
    }
    if (character === "{") {
      this.offset++;
      this.space();
      if (this.take("}")) return;
      const keys = new Set<string>();
      while (this.offset < this.source.length) {
        this.space();
        const key = this.string();
        if (keys.has(key))
          this.fail(`Duplicate object key ${JSON.stringify(key)}`);
        keys.add(key);
        this.space();
        this.require(":");
        this.value(depth + 1);
        this.space();
        if (this.take("}")) return;
        this.require(",");
      }
      this.fail("Unterminated JSON container");
    }
    if (character === "[") {
      this.offset++;
      this.space();
      if (this.take("]")) return;
      while (this.offset < this.source.length) {
        this.value(depth + 1);
        this.space();
        if (this.take("]")) return;
        this.require(",");
      }
      this.fail("Unterminated JSON container");
    }
    for (const literal of ["true", "false", "null"]) {
      if (this.source.startsWith(literal, this.offset)) {
        this.offset += literal.length;
        return;
      }
    }
    const token = this.source
      .slice(this.offset)
      .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u)?.[0];
    if (token === undefined) this.fail("Expected a JSON value");
    if (
      !/^-?(?:0|[1-9][0-9]*)$/u.test(token) ||
      !Number.isSafeInteger(Number(token)) ||
      Object.is(Number(token), -0)
    )
      this.fail(
        "Numbers must be safe integer literals, excluding negative zero",
      );
    this.offset += token.length;
  }

  private string(): string {
    const start = this.offset;
    this.require('"');
    let escaped = false;
    while (this.offset < this.source.length) {
      const character = this.source[this.offset++];
      if (!escaped && character === '"') {
        const value: unknown = JSON.parse(
          this.source.slice(start, this.offset),
        );
        if (typeof value !== "string") this.fail("Expected a string");
        for (const scalar of value) {
          const code = scalar.codePointAt(0);
          if (code !== undefined && code >= 0xd800 && code <= 0xdfff)
            this.fail("Unpaired Unicode surrogate");
        }
        return value;
      }
      escaped = !escaped && character === "\\";
    }
    return this.fail("Unterminated JSON string");
  }

  private space(): void {
    while (/[\t\n\r ]/u.test(this.source[this.offset] ?? "x")) this.offset++;
  }
  private take(character: string): boolean {
    if (this.source[this.offset] !== character) return false;
    this.offset++;
    return true;
  }
  private require(character: string): void {
    if (!this.take(character))
      this.fail(`Expected ${JSON.stringify(character)}`);
  }
  private fail(message: string): never {
    throw new Error(`${message} at character ${this.offset}.`);
  }
}
