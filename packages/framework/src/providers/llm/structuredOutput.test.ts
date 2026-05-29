import { test, expect, describe } from "bun:test";
import { z } from "zod";
import {
  StructuredOutputError,
  isZodSchema,
  toJsonSchema,
  parseStructured,
} from "./structuredOutput.ts";

describe("isZodSchema", () => {
  test("true for a Zod schema", () => {
    expect(isZodSchema(z.object({ a: z.string() }))).toBe(true);
  });

  test("false for a raw JSON Schema object", () => {
    expect(isZodSchema({ type: "object", properties: {} })).toBe(false);
  });
});

describe("toJsonSchema", () => {
  test("converts a Zod schema to JSON Schema", () => {
    const json = toJsonSchema(z.object({ name: z.string(), n: z.number() })) as any;
    expect(json.type).toBe("object");
    expect(json.properties.name.type).toBe("string");
    expect(json.required).toContain("name");
  });

  test("passes a raw JSON Schema object through unchanged", () => {
    const raw = { type: "object", properties: { x: { type: "number" } } };
    expect(toJsonSchema(raw)).toBe(raw);
  });
});

describe("parseStructured", () => {
  test("parses and validates against a Zod schema, returning typed data", () => {
    const schema = z.object({ title: z.string(), tags: z.array(z.string()) });
    const result = parseStructured('{"title":"X","tags":["a","b"]}', schema);
    expect(result).toEqual({ title: "X", tags: ["a", "b"] });
  });

  test("tolerates surrounding whitespace", () => {
    const result = parseStructured('  \n {"a":1}\n ', z.object({ a: z.number() }));
    expect(result).toEqual({ a: 1 });
  });

  test("returns the parsed value as-is when no schema is supplied", () => {
    const result = parseStructured<{ a: number }>('{"a":1}');
    expect(result).toEqual({ a: 1 });
  });

  test("does not validate when given a raw JSON Schema (no runtime check)", () => {
    // Raw JSON Schema can't validate here — the value is returned untouched even
    // though it doesn't match the declared shape.
    const result = parseStructured('{"a":"wrong-type"}', {
      type: "object",
      properties: { a: { type: "number" } },
    });
    expect(result).toEqual({ a: "wrong-type" });
  });

  test("throws StructuredOutputError on invalid JSON, carrying the raw text", () => {
    try {
      parseStructured("not json", z.object({ a: z.string() }));
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredOutputError);
      expect((e as StructuredOutputError).raw).toBe("not json");
    }
  });

  test("throws StructuredOutputError when the value fails Zod validation", () => {
    try {
      parseStructured('{"a":123}', z.object({ a: z.string() }));
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredOutputError);
      expect((e as StructuredOutputError).raw).toBe('{"a":123}');
    }
  });
});
