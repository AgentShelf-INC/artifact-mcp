// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function typeName(schema) {
  return schema.type === "object" ? "an object" : `a ${schema.type}`;
}

function validateNode(schema, value, path, errors) {
  if (schema.type === "object") {
    if (!isPlainObject(value)) {
      errors.push(`${path} must be ${typeName(schema)}`);
      return;
    }

    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path ? `${path}.` : ""}${key} is required`);
    }

    const properties = schema.properties || {};
    const unknown = Object.keys(value).filter((key) => !Object.hasOwn(properties, key));
    if (schema.additionalProperties === false) {
      for (const key of unknown) errors.push(`${path ? `${path}.` : ""}${key} is not allowed`);
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        validateNode(childSchema, value[key], path ? `${path}.${key}` : key, errors);
      }
    }
    if (isPlainObject(schema.additionalProperties)) {
      for (const key of unknown) {
        validateNode(schema.additionalProperties, value[key], path ? `${path}.${key}` : key, errors);
      }
    }
    return;
  }

  if (schema.type && typeof value !== schema.type) {
    errors.push(`${path} must be ${typeName(schema)}`);
  }
}

export function validateSchemaInput(schema, value) {
  const errors = [];
  validateNode(schema, value, "", errors);
  return errors.map((error) => error.replace(/^ must/, "arguments must"));
}

export function parseReactionInput(value) {
  if (!isPlainObject(value)) throw new Error("Reaction body must be a JSON object.");

  const keys = Object.keys(value);
  if (keys.length === 0) throw new Error("Reaction body must include favorite or vote.");
  const unknown = keys.find((key) => key !== "favorite" && key !== "vote");
  if (unknown) throw new Error(`Unknown reaction field: ${unknown}`);

  const update = {};
  if (Object.hasOwn(value, "favorite")) {
    if (![true, false, 0, 1].includes(value.favorite)) {
      throw new Error("favorite must be true, false, 0, or 1.");
    }
    update.favorite = value.favorite ? 1 : 0;
  }
  if (Object.hasOwn(value, "vote")) {
    if (![-1, 0, 1].includes(value.vote)) throw new Error("vote must be -1, 0, or 1.");
    update.vote = value.vote;
  }
  return update;
}
