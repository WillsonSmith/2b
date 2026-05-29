/**
 * Structured-output helpers shared by LLM providers and agents.
 *
 * A `StructuredSchema` is either a Zod schema (preferred — gives compile-time
 * types and runtime validation) or a raw JSON Schema object (escape hatch for
 * ad-hoc shapes). `toJsonSchema` normalizes either into the JSON Schema that
 * providers send to the model (e.g. Ollama's `format`), and `parseStructured`
 * turns the model's JSON text back into a typed, validated value.
 */
import { z } from "zod";

/** A Zod schema or a raw JSON Schema object describing the desired output. */
export type StructuredSchema = z.ZodType | Record<string, unknown>;

/**
 * Thrown when a model's structured output can't be parsed as JSON or fails
 * validation against the supplied Zod schema. Carries the raw model text so
 * callers can log or fall back.
 */
export class StructuredOutputError extends Error {
  constructor(
    message: string,
    /** The raw model output that failed to parse/validate. */
    public readonly raw: string,
    /** The underlying JSON.parse or Zod error, if any. */
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/** True when the value is a Zod schema rather than a raw JSON Schema object. */
export function isZodSchema(schema: StructuredSchema): schema is z.ZodType {
  return schema instanceof z.ZodType;
}

/**
 * Convert a `StructuredSchema` to a JSON Schema object suitable for a provider's
 * structured-output request. Zod schemas are converted via `z.toJSONSchema`;
 * raw JSON Schema objects are passed through unchanged.
 */
export function toJsonSchema(schema: StructuredSchema): object {
  return isZodSchema(schema) ? z.toJSONSchema(schema) : schema;
}

/**
 * Parse model output text into a typed value.
 *
 * - Always `JSON.parse`s the (trimmed) text — providers using structured output
 *   return raw JSON, so no fence-stripping is performed here.
 * - When `schema` is a Zod schema, the parsed value is validated and the typed
 *   `data` is returned.
 * - When `schema` is a raw JSON Schema (or omitted), the parsed value is
 *   returned as-is cast to `T` (no runtime validation).
 *
 * @throws {StructuredOutputError} if the text is not valid JSON or fails Zod
 *   validation.
 */
export function parseStructured<T>(text: string, schema?: StructuredSchema): T {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch (cause) {
    throw new StructuredOutputError(
      `Structured output was not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      text,
      cause,
    );
  }

  if (schema && isZodSchema(schema)) {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new StructuredOutputError(
        `Structured output failed schema validation: ${result.error.message}`,
        text,
        result.error,
      );
    }
    return result.data as T;
  }

  return value as T;
}
