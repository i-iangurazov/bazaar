import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  [key: string]: unknown;
};
export function baamToolSchema(schema: z.ZodTypeAny): JsonSchema {
  const json = zodToJsonSchema(schema, {
    $refStrategy: "none",
    effectStrategy: "input",
  }) as JsonSchema;
  delete json.$schema;
  const strict = (node: JsonSchema): JsonSchema => {
    if (node.properties) {
      const required = new Set(node.required ?? []);
      node.properties = Object.fromEntries(
        Object.entries(node.properties).map(([key, value]) => {
          const parsed = strict(value);
          return [key, required.has(key) ? parsed : { anyOf: [parsed, { type: "null" }] }];
        }),
      );
      node.required = Object.keys(node.properties);
      node.additionalProperties = false;
    }
    if (node.items) node.items = strict(node.items);
    if (node.anyOf) node.anyOf = node.anyOf.map(strict);
    return node;
  };
  return strict(json);
}
// OpenAI's strict contract represents omitted optional fields as null.
export function baamOptionalValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(baamOptionalValues);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, baamOptionalValues(v)]),
    );
  return value;
}
