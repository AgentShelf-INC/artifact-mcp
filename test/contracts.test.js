import test from "node:test";
import assert from "node:assert/strict";
import { validateSchemaInput } from "../lib/contracts.js";

const schema = {
  type: "object",
  properties: {
    html: { type: "string" },
    files: { type: "object", additionalProperties: { type: "string" } }
  },
  required: ["html"],
  additionalProperties: false
};

test("schema validation accepts declared arguments", () => {
  assert.deepEqual(validateSchemaInput(schema, { html: "<h1>Hi</h1>", files: { "site.css": "body{}" } }), []);
});

test("schema validation reports missing, wrongly typed, unknown, and nested arguments", () => {
  assert.deepEqual(validateSchemaInput(schema, { files: { "site.css": 42 }, surprise: true }), [
    "html is required",
    "surprise is not allowed",
    "files.site.css must be a string"
  ]);
});
