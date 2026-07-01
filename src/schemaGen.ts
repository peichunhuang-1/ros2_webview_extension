import * as path from 'path';
import * as fs from 'fs';

// --- Types -----------------------------------------------------------------

interface RosFieldType {
  type: string;
  isArray: boolean;
  isPrimitiveType: boolean;
  pkgName: string;
  arraySize: number;
  isUpperBound: boolean;
}

interface RosField {
  name: string;
  type: RosFieldType;
}

interface RosConstant {
  name: string;
  value: string | number;
}

interface RosMsgSpec {
  fields: RosField[];
  constants: RosConstant[];
}

interface RosSrvSpec {
  request: RosMsgSpec;
  response: RosMsgSpec;
}

interface RosActionSpec {
  goal: RosMsgSpec;
  result: RosMsgSpec;
  feedback: RosMsgSpec;
}

export type JsonSchema = Record<string, unknown>;

// --- Primitive type map -----------------------------------------------------

const rosToJsonSchemaType: Record<string, JsonSchema> = {
  bool:    { type: 'boolean' },
  string:  { type: 'string' },
  wstring: { type: 'string' },

  float32: { type: 'number' },
  float64: { type: 'number' },

  int8:  { type: 'integer', minimum: -128,                    maximum: 127 },
  int16: { type: 'integer', minimum: -32768,                  maximum: 32767 },
  int32: { type: 'integer', minimum: -2147483648,             maximum: 2147483647 },
  int64: { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },

  uint8:  { type: 'integer', minimum: 0, maximum: 255 },
  uint16: { type: 'integer', minimum: 0, maximum: 65535 },
  uint32: { type: 'integer', minimum: 0, maximum: 4294967295 },
  uint64: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },

  byte: { type: 'integer', minimum: 0, maximum: 255 },
  char: { type: 'string', minLength: 1, maxLength: 1 },
};

// --- Parser loader (ESM interop) -------------------------------------------

// rclnodejs is an optional native module — load once, cache the handle.
let parserHandle: {
  parseMessageFile(pkg: string, p: string): Promise<RosMsgSpec>;
  parseServiceFile(pkg: string, p: string): Promise<RosSrvSpec>;
  parseActionFile(pkg: string, p: string): Promise<RosActionSpec>;
} | null = null;

async function getParser() {
  if (parserHandle) { return parserHandle; }
  // Dynamic import handles ESM-from-CJS interop at runtime.
  const mod = await import('rclnodejs/rosidl_parser/rosidl_parser.js');
  parserHandle = (mod.default ?? mod) as typeof parserHandle;
  return parserHandle!;
}

// --- Filesystem helpers ----------------------------------------------------

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function findFiles(pkg: string, subdir: string, filename: string): string[] {
  const prefixPaths = (process.env.AMENT_PREFIX_PATH ?? '').split(':').filter(Boolean);
  return prefixPaths
    .map(p => path.join(p, 'share', pkg, subdir, filename))
    .filter(p => fs.existsSync(p));
}

// --- Enum matching ----------------------------------------------------------

function matchEnumField(
  properties: Record<string, JsonSchema>,
  constants: RosConstant[],
  fieldname: string,
): boolean {
  const upper = fieldname.toUpperCase();
  const enums: string[] = [];
  for (let i = constants.length - 1; i >= 0; i--) {
    const c = constants[i];
    if (String(c.name).toUpperCase().includes(upper)) {
      enums.push(`${c.name}:${c.value}`);
      constants.splice(i, 1);
    }
  }
  if (enums.length > 0) {
    properties[fieldname] = { title: fieldname, type: 'string', enum: enums };
    return true;
  }
  return false;
}

// --- Core parsers ----------------------------------------------------------

async function parseMsgFields(
  entity: { properties?: Record<string, JsonSchema> },
  pkg: string,
  msgFile: string,
): Promise<void> {
  const paths = findFiles(pkg, 'msg', msgFile);
  if (paths.length === 0) { return; }

  const parser = await getParser();
  let specs: RosMsgSpec | null = null;
  for (const p of paths) {
    try { specs = await parser.parseMessageFile(pkg, p); break; } catch (_) { /* try next */ }
  }
  if (!specs) { return; }

  if (!entity.properties) { entity.properties = {}; }
  const constants = [...specs.constants];
  const originalOrder = specs.fields.map(f => f.name);
  const fields = [...specs.fields].sort((a, b) => b.name.length - a.name.length);

  for (const field of fields) {
    const baseType = field.type.type;

    if (field.type.isArray) {
      let item: JsonSchema = {};
      if (field.type.isPrimitiveType) {
        item = clone(rosToJsonSchemaType[baseType] ?? { type: 'string' });
      } else {
        await parseMsgFields(item as { properties?: Record<string, JsonSchema> }, field.type.pkgName, `${baseType}.msg`);
      }
      const arr: JsonSchema = { type: 'array', title: field.name, items: item };
      if (field.type.arraySize > 0) {
        (arr as Record<string, unknown>).minItems = field.type.arraySize;
        (arr as Record<string, unknown>).maxItems = field.type.arraySize;
      } else if (field.type.isUpperBound) {
        (arr as Record<string, unknown>).maxItems = field.type.arraySize;
      }
      entity.properties[field.name] = arr;
      continue;
    }

    if (!field.type.isPrimitiveType) {
      const nested: { properties?: Record<string, JsonSchema> } = { properties: {} };
      await parseMsgFields(nested, field.type.pkgName, `${baseType}.msg`);
      entity.properties[field.name] = { type: 'object', title: field.name, ...nested };
      continue;
    }

    if (baseType.includes('int') && matchEnumField(entity.properties, constants, field.name)) { continue; }

    entity.properties[field.name] = {
      ...clone(rosToJsonSchemaType[baseType] ?? { type: 'string' }),
      title: field.name,
    };
  }

  // Restore original field order
  const sorted: Record<string, JsonSchema> = {};
  for (const key of originalOrder) {
    if (key in entity.properties) { sorted[key] = entity.properties[key]; }
  }
  entity.properties = sorted;
}

async function buildFieldSchema(field: RosField): Promise<JsonSchema> {
  if (field.type.isArray) {
    const item = field.type.isPrimitiveType
      ? clone(rosToJsonSchemaType[field.type.type] ?? { type: 'string' })
      : await readMsgSchema(field.type.pkgName, field.type.type);
    const arr: JsonSchema = { type: 'array', title: field.name, items: item };
    if (field.type.arraySize > 0) {
      (arr as Record<string, unknown>).minItems = field.type.arraySize;
      (arr as Record<string, unknown>).maxItems = field.type.arraySize;
    } else if (field.type.isUpperBound) {
      (arr as Record<string, unknown>).maxItems = field.type.arraySize;
    }
    return arr;
  }
  if (field.type.isPrimitiveType) {
    return { ...clone(rosToJsonSchemaType[field.type.type] ?? { type: 'string' }), title: field.name };
  }
  return { ...(await readMsgSchema(field.type.pkgName, field.type.type)), title: field.name };
}

async function buildFields(fields: RosField[]): Promise<Record<string, JsonSchema>> {
  const out: Record<string, JsonSchema> = {};
  for (const field of fields) {
    out[field.name] = await buildFieldSchema(field);
  }
  return out;
}

// --- Public API ------------------------------------------------------------

export async function readMsgSchema(packageName: string, messageName: string): Promise<JsonSchema> {
  const entity: { properties?: Record<string, JsonSchema> } = {};
  await parseMsgFields(entity, packageName, `${messageName}.msg`);
  return entity as JsonSchema;
}

export async function readSrvSchema(packageName: string, serviceName: string): Promise<JsonSchema> {
  const paths = findFiles(packageName, 'srv', `${serviceName}.srv`);
  if (paths.length === 0) { throw new Error(`Service file not found: ${packageName}/${serviceName}`); }

  const parser = await getParser();
  const specs = await parser.parseServiceFile(packageName, paths[0]);
  const request = await buildFields(specs.request.fields);
  return { type: 'object', properties: request };
}

export async function readActionSchema(packageName: string, actionName: string): Promise<JsonSchema> {
  const paths = findFiles(packageName, 'action', `${actionName}.action`);
  if (paths.length === 0) { throw new Error(`Action file not found: ${packageName}/${actionName}`); }

  const parser = await getParser();
  const specs = await parser.parseActionFile(packageName, paths[0]);
  return {
    goal:     await buildFields(specs.goal.fields),
    result:   await buildFields(specs.result.fields),
    feedback: await buildFields(specs.feedback.fields),
  };
}

export function isRos2Available(): boolean {
  const prefix = process.env.AMENT_PREFIX_PATH ?? '';
  return prefix.length > 0 && fs.existsSync(prefix.split(':')[0]);
}
