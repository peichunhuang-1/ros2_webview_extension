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

// --- Shared schema builders --------------------------------------------------

function primitiveSchema(baseType: string): JsonSchema {
  return clone(rosToJsonSchemaType[baseType] ?? { type: 'string' });
}

// Array schema with ROS bounds mapped onto minItems/maxItems: a fixed-size
// array ("T[N]") pins both, an upper-bounded one ("T[<=N]") only maxItems.
function arraySchema(field: RosField, items: JsonSchema): JsonSchema {
  const arr: Record<string, unknown> = { type: 'array', title: field.name, items };
  if (field.type.arraySize > 0) {
    arr.minItems = field.type.arraySize;
    arr.maxItems = field.type.arraySize;
  } else if (field.type.isUpperBound) {
    arr.maxItems = field.type.arraySize;
  }
  return arr;
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
        item = primitiveSchema(baseType);
      } else {
        await parseMsgFields(item as { properties?: Record<string, JsonSchema> }, field.type.pkgName, `${baseType}.msg`);
      }
      entity.properties[field.name] = arraySchema(field, item);
      continue;
    }

    if (!field.type.isPrimitiveType) {
      const nested: { properties?: Record<string, JsonSchema> } = { properties: {} };
      await parseMsgFields(nested, field.type.pkgName, `${baseType}.msg`);
      entity.properties[field.name] = { type: 'object', title: field.name, ...nested };
      continue;
    }

    if (baseType.includes('int') && matchEnumField(entity.properties, constants, field.name)) { continue; }

    entity.properties[field.name] = { ...primitiveSchema(baseType), title: field.name };
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
      ? primitiveSchema(field.type.type)
      : await readMsgSchema(field.type.pkgName, field.type.type);
    return arraySchema(field, item);
  }
  if (field.type.isPrimitiveType) {
    return { ...primitiveSchema(field.type.type), title: field.name };
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
  const response = await buildFields(specs.response.fields);
  return { request: {properties: request }, response: {properties: response } };
}

export async function readActionSchema(packageName: string, actionName: string): Promise<JsonSchema> {
  const paths = findFiles(packageName, 'action', `${actionName}.action`);
  if (paths.length === 0) { throw new Error(`Action file not found: ${packageName}/${actionName}`); }

  const parser = await getParser();
  const specs = await parser.parseActionFile(packageName, paths[0]);
  const goal = await buildFields(specs.goal.fields);
  const result = await buildFields(specs.result.fields);
  const feedback = await buildFields(specs.feedback.fields);
  return {
    goal:     { properties: goal },
    result:   { properties: result },
    feedback: { properties: feedback },
  };
}

export function isRos2Available(): boolean {
  const prefix = process.env.AMENT_PREFIX_PATH ?? '';
  return prefix.length > 0 && fs.existsSync(prefix.split(':')[0]);
}

// --- Interface listing -------------------------------------------------------

export interface InterfaceEntry {
  pkg:  string;
  name: string;
}

export interface InterfaceList {
  msgs:    InterfaceEntry[];
  srvs:    InterfaceEntry[];
  actions: InterfaceEntry[];
}

export function listInterfaces(): InterfaceList {
  const prefixPaths = (process.env.AMENT_PREFIX_PATH ?? '').split(':').filter(Boolean);

  const kinds: { subdir: string; ext: string; out: InterfaceEntry[]; seen: Set<string> }[] = [
    { subdir: 'msg',    ext: '.msg',    out: [], seen: new Set() },
    { subdir: 'srv',    ext: '.srv',    out: [], seen: new Set() },
    { subdir: 'action', ext: '.action', out: [], seen: new Set() },
  ];

  for (const prefix of prefixPaths) {
    const shareDir = path.join(prefix, 'share');
    let pkgs: string[];
    try { pkgs = fs.readdirSync(shareDir); } catch { continue; }

    for (const pkg of pkgs) {
      for (const kind of kinds) {
        const dir = path.join(shareDir, pkg, kind.subdir);
        let files: string[];
        try { files = fs.readdirSync(dir); } catch { continue; }

        for (const file of files) {
          if (!file.endsWith(kind.ext)) { continue; }
          const name = file.slice(0, -kind.ext.length);
          const id = `${pkg}/${name}`;
          if (kind.seen.has(id)) { continue; }
          kind.seen.add(id);
          kind.out.push({ pkg, name });
        }
      }
    }
  }

  for (const kind of kinds) {
    kind.out.sort((a, b) => `${a.pkg}/${a.name}`.localeCompare(`${b.pkg}/${b.name}`));
  }

  return { msgs: kinds[0].out, srvs: kinds[1].out, actions: kinds[2].out };
}
