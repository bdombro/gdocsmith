#!/usr/bin/env bun
// @bun
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// ../bun-argsbarg/src/config/file.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync4, readFileSync as readFileSync2, rmSync as rmSync2, unlinkSync, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname5, join as join5 } from "node:path";

// ../bun-argsbarg/src/core/types.ts
var CliValueFormat;
((CliValueFormat2) => {
  CliValueFormat2["Duration"] = "duration";
  CliValueFormat2["CommaList"] = "comma-list";
  CliValueFormat2["Date"] = "date";
  CliValueFormat2["DateTime"] = "date-time";
})(CliValueFormat ||= {});
function isCliLeaf(node) {
  return "handler" in node && typeof node.handler === "function";
}
function isDocumentLeaf(leaf) {
  return leaf.kind === "document" || leaf.kind === "json";
}
function isCliRouter(node) {
  return "commands" in node && Array.isArray(node.commands);
}
function leafOutputSchema(leaf) {
  return leaf.outputSchema;
}

class CliSchemaValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliSchemaValidationError";
  }
}

// ../bun-argsbarg/src/config/entry.ts
function defaultConfigEntryTitle(key) {
  return key;
}
function defaultConfigEntrySensitive(key) {
  return /key|token|secret|password/i.test(key);
}
function configEntryRequired(key, entry, jsonSchemaRequired) {
  if (entry.required === false) {
    return false;
  }
  if (jsonSchemaRequired !== undefined) {
    return jsonSchemaRequired.has(key);
  }
  return true;
}
function configEntrySensitive(key, entry) {
  return entry.sensitive ?? defaultConfigEntrySensitive(key);
}
function configUserConfigKey(key) {
  const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return snake || "config_key";
}
function jsonSchemaRequiredKeys(jsonSchema) {
  const required = jsonSchema.required;
  if (!Array.isArray(required)) {
    return;
  }
  return new Set(required.filter((k) => typeof k === "string"));
}
function configCommandsEnabled(program) {
  if (!program.appConfig) {
    return false;
  }
  const commands = program.appConfig.commands;
  if (commands === false) {
    return false;
  }
  if (typeof commands === "object" && commands.enabled === false) {
    return false;
  }
  return true;
}
function configMcpSetEnabled(program) {
  const commands = program.appConfig?.commands;
  if (typeof commands === "object" && commands.mcpSet === false) {
    return false;
  }
  return true;
}

// ../bun-argsbarg/src/runtime/capabilities.ts
function resolveCapabilities(program) {
  const configure = program.configure?.enabled !== false;
  return {
    http: program.httpServer?.enabled === true,
    completion: program.completion?.enabled !== false,
    mcp: program.mcpServer?.enabled === true,
    configure,
    docs: program.docs?.enabled !== false,
    configCommands: configCommandsEnabled(program)
  };
}
function reservedCommandNames(caps) {
  const names = ["version"];
  if (caps.completion) {
    names.unshift("completion");
  }
  if (caps.configure) {
    names.push("configure");
  }
  if (caps.docs) {
    names.push("docs");
  }
  if (caps.mcp) {
    names.push("mcp");
  }
  if (caps.http) {
    names.push("http");
  }
  return names;
}
function skipsRequiredAppConfigExit(path, caps) {
  const root = path[0];
  if (root === "configure" && caps.configure) {
    const sub = path[1];
    if (!sub || sub === "get" || sub === "set" || sub === "install" || sub === "uninstall" || sub === "status") {
      return true;
    }
  }
  if (root === "docs" && caps.docs) {
    return true;
  }
  return false;
}
function capabilityDeniedMessage(feature) {
  switch (feature) {
    case "completion":
      return `Shell completion is not available for this app.
`;
    case "http":
      return `HTTP API is not available for this app.
`;
    case "mcp":
      return `MCP is not available for this app.
`;
    case "configure":
      return `Configure is not available for this app.
`;
    case "docs":
      return `Documentation commands are not available for this app.
`;
  }
}
function assertBuiltinAllowed(argv, caps) {
  if (argv.length < 1) {
    return;
  }
  const first = argv[0];
  if (first === "completion" && !caps.completion) {
    process.stderr.write(capabilityDeniedMessage("completion"));
    process.exit(1);
  }
  if (first === "mcp" && !caps.mcp) {
    process.stderr.write(capabilityDeniedMessage("mcp"));
    process.exit(1);
  }
  if (first === "http" && !caps.http) {
    process.stderr.write(capabilityDeniedMessage("http"));
    process.exit(1);
  }
  if (first === "configure" && !caps.configure) {
    process.stderr.write(capabilityDeniedMessage("configure"));
    process.exit(1);
  }
  if (first === "docs" && !caps.docs) {
    process.stderr.write(capabilityDeniedMessage("docs"));
    process.exit(1);
  }
}

// ../bun-argsbarg/src/runtime/exposure.ts
function isCliHidden(node) {
  return node.cli?.hidden === true;
}
function isOptionCliHidden(opt) {
  return opt.cli?.hidden === true;
}
function isCliSchemaHidden(node) {
  if (node.cli?.schema?.enabled === false) {
    return true;
  }
  if (node.cli?.schema?.hidden === true) {
    return true;
  }
  return isCliHidden(node);
}
function isMcpHidden(leaf) {
  if (leaf.mcpTool?.enabled === false) {
    return true;
  }
  return leaf.mcpTool?.hidden === true;
}
function isCliCallable(node, parentEnabled = true) {
  if (!parentEnabled) {
    return false;
  }
  if (node.cli?.enabled === false) {
    return false;
  }
  return true;
}
function isHttpHidden(node) {
  return node.http?.hidden === true;
}
function isHttpDisabled(node) {
  return node.http?.enabled === false;
}
function visibleOptions(options) {
  return (options ?? []).filter((o) => !isOptionCliHidden(o));
}
function presentationNode(node) {
  if (isCliHidden(node)) {
    return null;
  }
  const options = visibleOptions(node.options);
  if (isCliRouter(node)) {
    const commands = node.commands.map((ch) => presentationNode(ch)).filter((ch) => ch !== null);
    return { ...node, options, commands };
  }
  return { ...node, options };
}
function visibleSubcommands(cmds) {
  return cmds.filter((c) => !isCliHidden(c));
}
function leafHttpResponseDefaults(leaf) {
  return {
    contentType: leaf.http?.successContentType,
    contentDisposition: leaf.http?.contentDisposition
  };
}

// ../bun-argsbarg/src/core/wire-schema.ts
var DURATION_PATTERN = "^\\d+[hdms]?$";
var MCP_WIRE_OMIT_PRESENCE = new Set(["json", "yes", "verbose"]);
function optionProperty(opt) {
  const base = {
    description: opt.description
  };
  if (opt.default !== undefined) {
    base.default = opt.default;
  }
  switch (opt.kind) {
    case "presence" /* Presence */:
      return { type: "boolean", ...base };
    case "string" /* String */: {
      if (opt.format === "comma-list" /* CommaList */) {
        return {
          oneOf: [
            { type: "string", ...base },
            { type: "array", items: { type: "string" }, ...base }
          ]
        };
      }
      const stringBase = { type: "string", ...base };
      if (opt.format === "duration" /* Duration */) {
        return { ...stringBase, pattern: DURATION_PATTERN };
      }
      if (opt.format === "date" /* Date */) {
        return { ...stringBase, format: "date" };
      }
      if (opt.format === "date-time" /* DateTime */) {
        return { ...stringBase, format: "date-time" };
      }
      if (opt.pattern !== undefined) {
        return { ...stringBase, pattern: opt.pattern };
      }
      return stringBase;
    }
    case "number" /* Number */:
      return { type: "number", ...base };
    case "enum" /* Enum */:
      return { type: "string", enum: opt.choices, ...base };
    case "json" /* Json */:
      return { type: "object", ...base };
  }
}
function positionalProperty(p) {
  const base = { description: p.description };
  const { argMax = 1 } = p;
  if (argMax === 0) {
    return { type: "array", items: { type: "string" }, ...base };
  }
  return { type: "string", ...base };
}
function leafWireOptions(leaf) {
  return visibleOptions(leaf.options).filter((o) => {
    if (o.kind === "presence" /* Presence */ && MCP_WIRE_OMIT_PRESENCE.has(o.name)) {
      return false;
    }
    return true;
  });
}
function buildLeafInputSchema(leaf) {
  if (leaf.inputSchema !== undefined) {
    return leaf.inputSchema;
  }
  const properties = {};
  const required = [];
  for (const opt of leafWireOptions(leaf)) {
    properties[opt.name] = optionProperty(opt);
    if (opt.required) {
      required.push(opt.name);
    }
  }
  for (const p of leaf.positionals ?? []) {
    properties[p.name] = positionalProperty(p);
    const { argMin = 1, argMax = 1 } = p;
    if (argMax === 1 && argMin >= 1) {
      required.push(p.name);
    }
  }
  const schema = {
    type: "object",
    properties,
    additionalProperties: false
  };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}

// ../bun-argsbarg/src/http/paths.ts
var HTTP_RESERVED_TOP_LEVEL_SEGMENTS = new Set(["health", "openapi.json", "swagger", "tools"]);
function resolveHttpPathPrefix(program) {
  const raw = program.httpServer?.pathPrefix;
  if (raw === undefined || raw === "") {
    return "";
  }
  return raw;
}
function buildHttpUserPath(prefix, urlSegments) {
  const tail = urlSegments.map((s) => s.startsWith(":") ? `{${s.slice(1)}}` : s).join("/");
  if (!prefix) {
    return tail ? `/${tail}` : "/";
  }
  return tail ? `${prefix}/${tail}` : prefix;
}
function httpUserPathRegexPrefix(prefix) {
  if (!prefix) {
    return "";
  }
  return prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function httpUserPathGlob(prefix) {
  return prefix ? `${prefix}/*` : "/*";
}

// ../bun-argsbarg/src/http/routes.ts
var VERB_KEYS = new Set(["get", "post", "put", "patch", "delete"]);
function isParamRouterKey(key) {
  return key.startsWith(":");
}
function inferHttpMethod(leaf) {
  if (leaf.http?.method) {
    return leaf.http.method;
  }
  const lower = leaf.key.toLowerCase();
  if (VERB_KEYS.has(lower)) {
    return lower.toUpperCase();
  }
  return "POST";
}
function isVerbLeaf(leaf) {
  return VERB_KEYS.has(leaf.key.toLowerCase()) && leaf.http?.method === undefined;
}
function segmentForNode(node) {
  return node.http?.segment ?? node.key;
}
function leafHttpExposed(leaf) {
  if (isHttpDisabled(leaf) || isHttpHidden(leaf)) {
    return false;
  }
  return true;
}
function pushRoute(routes, leaf, state, pathPrefix) {
  const urlSegments = [...state.urlSegments];
  const commandPath = [...state.commandPath];
  if (!isVerbLeaf(leaf)) {
    const seg = segmentForNode(leaf);
    if (urlSegments[urlSegments.length - 1] !== seg) {
      urlSegments.push(seg);
    }
    if (commandPath[commandPath.length - 1] !== leaf.key) {
      commandPath.push(leaf.key);
    }
  }
  const openApiPath = buildHttpUserPath(pathPrefix, urlSegments);
  const patternParts = urlSegments.map((s) => s.startsWith(":") ? "([^/]+)" : escapeRegex(s));
  const regexPrefix = httpUserPathRegexPrefix(pathPrefix);
  const tail = patternParts.length > 0 ? `/${patternParts.join("/")}` : "";
  const pathPattern = new RegExp(`^${regexPrefix}${tail}/?$`);
  routes.push({
    method: inferHttpMethod(leaf),
    openApiPath,
    pathPattern,
    commandPath,
    paramNames: [...state.paramNames],
    leaf
  });
}
function walk(node, state, routes, pathPrefix) {
  if (isHttpDisabled(node) || isHttpHidden(node)) {
    return;
  }
  if (isCliLeaf(node)) {
    if (leafHttpExposed(node)) {
      pushRoute(routes, node, state, pathPrefix);
    }
    return;
  }
  for (const child of node.commands) {
    if (isParamRouterKey(child.key)) {
      const paramName = child.key.slice(1);
      walk(child, {
        urlSegments: [...state.urlSegments, child.key],
        commandPath: [...state.commandPath, child.key],
        paramNames: [...state.paramNames, paramName]
      }, routes, pathPrefix);
      continue;
    }
    if (isCliLeaf(child)) {
      walk(child, {
        urlSegments: state.urlSegments,
        commandPath: [...state.commandPath, child.key],
        paramNames: state.paramNames
      }, routes, pathPrefix);
      continue;
    }
    const seg = segmentForNode(child);
    walk(child, {
      urlSegments: [...state.urlSegments, seg],
      commandPath: [...state.commandPath, child.key],
      paramNames: state.paramNames
    }, routes, pathPrefix);
  }
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function collectHttpRoutes(program) {
  const routes = [];
  if (!program.httpServer?.enabled) {
    return routes;
  }
  const pathPrefix = resolveHttpPathPrefix(program);
  if (isCliLeaf(program)) {
    walk(program, { urlSegments: [], commandPath: [], paramNames: [] }, routes, pathPrefix);
    return routes;
  }
  for (const child of program.commands) {
    if (child.key === "completion" || child.key === "configure" || child.key === "docs" || child.key === "mcp" || child.key === "version" || child.key === "http") {
      continue;
    }
    if (isCliLeaf(child)) {
      walk(child, { urlSegments: [], commandPath: [child.key], paramNames: [] }, routes, pathPrefix);
    } else {
      walk(child, { urlSegments: [segmentForNode(child)], commandPath: [child.key], paramNames: [] }, routes, pathPrefix);
    }
  }
  return routes;
}
function matchHttpRoute(program, method, pathname) {
  const routes = collectHttpRoutes(program);
  const upper = method.toUpperCase();
  let best;
  for (const route of routes) {
    if (route.method !== upper) {
      continue;
    }
    const m = route.pathPattern.exec(pathname);
    if (!m) {
      continue;
    }
    const pathParams = {};
    for (let i = 0;i < route.paramNames.length; i++) {
      const name = route.paramNames[i];
      const val = m[i + 1];
      if (name && val !== undefined) {
        pathParams[name] = decodeURIComponent(val);
      }
    }
    const score = route.openApiPath.length;
    if (!best || score > best.score) {
      best = { route, pathParams, score };
    }
  }
  if (!best) {
    return { ok: false };
  }
  return { ok: true, route: best.route, pathParams: best.pathParams };
}
function httpRequestToArgv(_program, route, pathParams, query, body) {
  const argv = [];
  for (const key of route.commandPath) {
    if (isParamRouterKey(key)) {
      const name = key.slice(1);
      const val = pathParams[name];
      if (val === undefined || val.length === 0) {
        return { error: `Missing path parameter: ${name}` };
      }
      argv.push(val);
    } else {
      argv.push(key);
    }
  }
  const leaf = route.leaf;
  if (isDocumentLeaf(leaf)) {
    return argv;
  }
  const merged = { ...body, ...query };
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
      try {
        merged[k] = JSON.parse(v);
      } catch {
        merged[k] = v;
      }
    }
  }
  for (const opt of leafWireOptions(leaf)) {
    if (opt.kind === "json" /* Json */) {
      continue;
    }
    const val = merged[opt.name];
    if (val === undefined) {
      continue;
    }
    if (opt.kind === "presence" /* Presence */) {
      if (val === true || val === "true" || val === "1") {
        argv.push(`--${opt.name}`);
      }
      continue;
    }
    const formatted = formatMcpOptionValue(opt, val);
    if (typeof formatted !== "string") {
      return formatted;
    }
    argv.push(`--${opt.name}`, formatted);
  }
  if (leafHasYesOption(leaf) && !argv.includes("--yes")) {
    argv.push("--yes");
  }
  for (const p of leaf.positionals ?? []) {
    const val = merged[p.name] ?? pathParams[p.name];
    const { argMin = 1, argMax = 1 } = p;
    if (argMax === 0) {
      const raw = merged[p.name];
      if (raw === undefined) {
        if (argMin >= 1) {
          return { error: `Missing argument: ${p.name} (use a JSON array)` };
        }
        continue;
      }
      if (!Array.isArray(raw)) {
        return { error: `Argument ${p.name} must be a JSON array of strings` };
      }
      const items = raw.map(String).filter(Boolean);
      if (items.length === 0 && argMin >= 1) {
        return { error: `Missing argument: ${p.name}` };
      }
      argv.push(...items);
      continue;
    }
    if (val === undefined || val === "") {
      if (argMin >= 1) {
        return { error: `Missing argument: ${p.name}` };
      }
      continue;
    }
    argv.push(String(val));
  }
  return argv;
}
function defaultSuccessStatus(method, hasBody) {
  switch (method) {
    case "GET":
      return 200;
    case "POST":
      return 201;
    case "PUT":
    case "PATCH":
      return 200;
    case "DELETE":
      return hasBody ? 200 : 204;
    default:
      return 200;
  }
}

// ../bun-argsbarg/src/http/schema-deref.ts
function decodeJsonPointerSegment(segment) {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function resolveJsonPointer(root, ref) {
  if (!ref.startsWith("#/")) {
    return;
  }
  const segments = ref.slice(2).split("/").filter((segment) => segment.length > 0).map(decodeJsonPointerSegment);
  let current = root;
  for (const segment of segments) {
    if (!isPlainObject(current)) {
      return;
    }
    current = current[segment];
  }
  return current;
}
function derefValue(value, root, resolving) {
  if (Array.isArray(value)) {
    return value.map((item) => derefValue(item, root, resolving));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  if (typeof value.$ref === "string") {
    const { $ref, ...siblings } = value;
    if (resolving.has($ref)) {
      return value;
    }
    const target = resolveJsonPointer(root, $ref);
    if (target === undefined) {
      return value;
    }
    resolving.add($ref);
    const resolved = derefValue(structuredClone(target), root, resolving);
    resolving.delete($ref);
    if (!isPlainObject(resolved)) {
      return resolved;
    }
    if (Object.keys(siblings).length === 0) {
      return resolved;
    }
    return { ...resolved, ...siblings };
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "definitions" || key === "$defs") {
      continue;
    }
    out[key] = derefValue(child, root, resolving);
  }
  return out;
}
function dereferenceJsonSchema(schema) {
  const root = structuredClone(schema);
  return derefValue(root, root, new Set);
}

// ../bun-argsbarg/src/http/openapi.ts
var JSON_CONTENT_TYPE = "application/json; charset=utf-8";
function defaultErrorSchema() {
  return {
    type: "object",
    properties: { error: { type: "string" } },
    required: ["error"]
  };
}
function errorResponseSchema(program) {
  const custom = program.httpServer?.errors?.errorSchema;
  return custom ? dereferenceJsonSchema(custom) : defaultErrorSchema();
}
function errorResponseEntry(program, description) {
  return {
    description,
    content: {
      [JSON_CONTENT_TYPE]: {
        schema: errorResponseSchema(program)
      }
    }
  };
}
function buildSuccessResponses(route) {
  const contentType = route.leaf.http?.successContentType ?? "application/json";
  const media = {};
  const method = route.method;
  if (contentType.includes("application/json")) {
    const outputSchema = route.leaf.outputSchema ?? { type: "object" };
    media[contentType] = {
      schema: dereferenceJsonSchema(outputSchema)
    };
  } else if (contentType.includes("text/html")) {
    media[contentType] = { schema: { type: "string" } };
  } else {
    media[contentType] = { schema: { type: "string", format: "binary" } };
  }
  const status = String(route.leaf.http?.successStatus ?? defaultSuccessStatus(method, method !== "DELETE"));
  if (method === "DELETE" && status === "204") {
    return {
      "204": { description: "Successful invocation" }
    };
  }
  return {
    [status]: {
      description: "Successful invocation",
      content: media
    }
  };
}
function methodLower(method) {
  return method.toLowerCase();
}
var HEALTH_TAG = "health";
var livenessResponseSchema = {
  type: "object",
  properties: { ok: { type: "boolean", const: true } },
  required: ["ok"]
};
var readinessCheckSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    error: { type: "string" },
    missing: { type: "array", items: { type: "string" } }
  },
  required: ["ok"]
};
var readinessResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    checks: {
      type: "object",
      properties: {
        config_file: readinessCheckSchema,
        config_required: readinessCheckSchema,
        custom: readinessCheckSchema
      },
      required: ["config_file", "config_required", "custom"]
    }
  },
  required: ["ok", "checks"]
};
function jsonResponseEntry(description, schema) {
  return {
    description,
    content: {
      [JSON_CONTENT_TYPE]: { schema }
    }
  };
}
function livenessGetOp() {
  return {
    tags: [HEALTH_TAG],
    operationId: "health_liveness",
    summary: "Liveness probe",
    description: "Returns 200 when the HTTP server is online and accepting requests. Does not run config or readiness checks — use for orchestrator liveness probes only.",
    responses: {
      "200": jsonResponseEntry("Server is online", livenessResponseSchema)
    }
  };
}
function buildHealthPaths() {
  return {
    "/health/liveness": {
      get: livenessGetOp()
    },
    "/health/readiness": {
      get: {
        tags: [HEALTH_TAG],
        operationId: "health_readiness",
        summary: "Readiness probe",
        description: "Returns 200 when the server is online and all readiness checks pass (config file, required app config, and optional program.readiness). Returns 503 when any check fails — use for orchestrator readiness probes before routing traffic.",
        responses: {
          "200": jsonResponseEntry("Online and ready to serve traffic", readinessResponseSchema),
          "503": jsonResponseEntry("Online but not ready (one or more checks failed)", readinessResponseSchema)
        }
      }
    }
  };
}
function topLevelCommandKey(route, program) {
  const key = route.commandPath.find((k) => !k.startsWith(":"));
  return key ?? program.key;
}
function findTopLevelCommand(program, key) {
  if (isCliLeaf(program)) {
    return program.key === key ? program : undefined;
  }
  return program.commands.find((c) => c.key === key);
}
function collectCommandTags(program, routes) {
  const names = [...new Set(routes.map((route) => topLevelCommandKey(route, program)))].sort();
  return names.map((name) => {
    const node = findTopLevelCommand(program, name);
    return node?.description ? { name, description: node.description } : { name };
  });
}
function generateOpenApi(program) {
  const routes = collectHttpRoutes(program);
  const paths = program.httpServer?.enabled ? buildHealthPaths() : {};
  const commandTags = collectCommandTags(program, routes);
  for (const route of routes) {
    const pathKey = route.openApiPath;
    const existing = paths[pathKey] ?? {};
    const op = {
      tags: [topLevelCommandKey(route, program)],
      operationId: route.openApiPath.replace(/\//g, "_").replace(/[{}]/g, ""),
      summary: route.leaf.description ?? route.leaf.key,
      responses: {
        ...buildSuccessResponses(route),
        "400": errorResponseEntry(program, "Invalid arguments or help requested"),
        "404": errorResponseEntry(program, "Not found"),
        "500": errorResponseEntry(program, "Handler error"),
        "503": errorResponseEntry(program, "Not ready or missing required config")
      }
    };
    if (route.paramNames.length > 0) {
      op.parameters = route.paramNames.map((name) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string" }
      }));
    }
    const method = methodLower(route.method);
    if (method === "get" || method === "delete") {
      op.parameters = [
        ...op.parameters ?? [],
        ...leafWireOptions(route.leaf).map((opt) => ({
          name: opt.name,
          in: "query",
          required: opt.required ?? false,
          schema: { type: "string" },
          description: opt.description
        }))
      ];
    } else {
      op.requestBody = {
        required: isDocumentLeaf(route.leaf),
        content: {
          [JSON_CONTENT_TYPE]: {
            schema: dereferenceJsonSchema(buildLeafInputSchema(route.leaf))
          }
        }
      };
    }
    existing[method] = op;
    paths[pathKey] = existing;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: program.key,
      version: program.version,
      description: program.description
    },
    ...program.httpServer?.enabled ? {
      tags: [
        {
          name: HEALTH_TAG,
          description: "Orchestrator health probes — liveness (online) vs readiness (online + checks passed)."
        },
        ...commandTags
      ]
    } : {},
    paths
  };
}
function openApiJson(program) {
  return `${JSON.stringify(generateOpenApi(program), null, 2)}
`;
}

// ../bun-argsbarg/src/help.ts
var style = {
  wrap(prefix, body, suffix) {
    return prefix + body + suffix;
  },
  red(msg) {
    return this.wrap("\x1B[31m", msg, "\x1B[0m");
  },
  gray(msg) {
    return this.wrap("\x1B[90m", msg, "\x1B[0m");
  },
  bold(msg) {
    return this.wrap("\x1B[1m", msg, "\x1B[0m");
  },
  white(msg) {
    return this.wrap("\x1B[37m", msg, "\x1B[0m");
  },
  aquaBold(msg) {
    return this.wrap("\x1B[96m\x1B[1m", msg, "\x1B[0m");
  },
  greenBright(msg) {
    return this.wrap("\x1B[92m", msg, "\x1B[0m");
  },
  grayBoldTitle(title) {
    return this.gray(this.bold(title));
  }
};
var kBoxTL = "╭";
var kBoxTR = "╮";
var kBoxV = "│";
var kBoxBL = "╰";
var kBoxBR = "╯";
var kBoxH = "─";
function getHelpWidth() {
  return Math.max(40, process.stdout.columns || 80);
}
function isOutputTTY(useStderr) {
  return useStderr ? !!process.stderr.isTTY : !!process.stdout.isTTY;
}
function visibleWidth(s) {
  let w = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x1B" && i + 1 < s.length && s[i + 1] === "[") {
      i += 2;
      while (i < s.length && s[i] !== "m") {
        i += 1;
      }
      if (i < s.length)
        i += 1;
      continue;
    }
    w += 1;
    i += 1;
  }
  return w;
}
function repeatBoxH(n) {
  return kBoxH.repeat(Math.max(0, n));
}
function spaces(n) {
  return " ".repeat(Math.max(0, n));
}
function padVisible(s, width) {
  return s + spaces(Math.max(0, width - visibleWidth(s)));
}
function wrapParagraph(text, width) {
  const available = Math.max(1, width);
  const out = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    if (cur.length === 0) {
      cur = word;
      continue;
    }
    if (cur.length + 1 + word.length <= available) {
      cur += ` ${word}`;
    } else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur.length > 0)
    out.push(cur);
  return out;
}
function wrapText(text, width) {
  const out = [];
  const lines = text.split(`
`);
  for (const line of lines) {
    if (line.trim().length === 0) {
      out.push("");
      continue;
    }
    if (line[0] === " " || line[0] === "\t") {
      out.push(line);
      continue;
    }
    out.push(...wrapParagraph(line, width));
  }
  if (out.length === 0)
    out.push("");
  return out;
}
function optKindLabel(k, o) {
  switch (k) {
    case "presence" /* Presence */:
      return "";
    case "number" /* Number */:
      return " <number>";
    case "string" /* String */:
      return " <string>";
    case "enum" /* Enum */: {
      const choices = o?.choices ?? [];
      if (choices.length === 0) {
        return " <choice>";
      }
      if (choices.length <= 4) {
        return ` <${choices.join("|")}>`;
      }
      return ` <${choices.slice(0, 3).join("|")}|…>`;
    }
    case "json" /* Json */:
      return " <json>";
  }
}
function cliOptionLabel(o, color) {
  let r = `--${o.name}${optKindLabel(o.kind, o)}`;
  if (o.shortName)
    r += `, -${o.shortName}`;
  if (!color)
    return r;
  const sepIdx = r.indexOf(", ");
  if (sepIdx === -1)
    return style.aquaBold(r);
  const left = r.slice(0, sepIdx);
  const right = r.slice(sepIdx + 2);
  return `${style.aquaBold(left)} ${style.greenBright(right)}`;
}
var CLI_NOTES_PROGRAM = "{argsbarg:program}";
function cliResolveNotes(notes, appKey) {
  return notes.replaceAll(CLI_NOTES_PROGRAM, appKey);
}
function cliPositionalLabel(p, color) {
  const { argMin = 1, argMax = 1 } = p;
  let r;
  if (argMax === 1) {
    r = argMin === 0 ? `[${p.name}]` : `<${p.name}>`;
  } else {
    r = argMin === 0 ? `[${p.name}...]` : `<${p.name}...>`;
  }
  if (!color)
    return r;
  return style.aquaBold(r);
}
function renderTextBox(title, lines, hw, color) {
  if (lines.length === 0)
    return [];
  const titleLead = color ? style.gray(`${kBoxH} `) + style.grayBoldTitle(title) + style.gray(" ") : `${kBoxH} ${title} `;
  let contentWidth = Math.max(visibleWidth(titleLead) + 1, hw - 4);
  for (const line of lines) {
    contentWidth = Math.max(contentWidth, visibleWidth(line));
  }
  const borderWidth = contentWidth + 2;
  const headerFill = Math.max(1, borderWidth - visibleWidth(titleLead));
  const out = [];
  out.push((color ? style.gray(kBoxTL) : kBoxTL) + titleLead + (color ? style.gray(repeatBoxH(headerFill) + kBoxTR) : repeatBoxH(headerFill) + kBoxTR));
  for (const line of lines) {
    const padded = padVisible(line, contentWidth);
    out.push(`${color ? style.gray(kBoxV) : kBoxV} ${padded} ${color ? style.gray(kBoxV) : kBoxV}`);
  }
  out.push(color ? style.gray(kBoxBL + repeatBoxH(borderWidth) + kBoxBR) : kBoxBL + repeatBoxH(borderWidth) + kBoxBR);
  return out;
}
function renderTableBox(title, rows, hw, color) {
  if (rows.length === 0)
    return [];
  let labelWidth = 0;
  for (const row of rows) {
    labelWidth = Math.max(labelWidth, visibleWidth(row.label));
  }
  let titleLead;
  if (color) {
    titleLead = style.gray(`${kBoxH} `) + style.grayBoldTitle(title) + style.gray(" ");
  } else {
    titleLead = `${kBoxH} ${title} `;
  }
  const targetContentWidth = Math.max(visibleWidth(titleLead) + 1, hw - 4);
  const descWidth = Math.max(1, targetContentWidth - labelWidth - 2);
  const bodyLines = [];
  for (const row of rows) {
    const wrapped = wrapText(row.description, descWidth);
    const first = `${row.label + spaces(labelWidth - visibleWidth(row.label))}  ${color ? style.white(wrapped[0]) : wrapped[0]}`;
    bodyLines.push(first);
    for (let idx = 1;idx < wrapped.length; idx++) {
      const pad = color ? style.gray(spaces(labelWidth)) : spaces(labelWidth);
      bodyLines.push(`${pad}  ${color ? style.white(wrapped[idx]) : wrapped[idx]}`);
    }
  }
  let contentWidth = targetContentWidth;
  for (const line of bodyLines) {
    contentWidth = Math.max(contentWidth, visibleWidth(line));
  }
  const borderWidth = contentWidth + 2;
  const headerFill = Math.max(1, borderWidth - visibleWidth(titleLead));
  const out = [];
  out.push((color ? style.gray(kBoxTL) : kBoxTL) + titleLead + (color ? style.gray(repeatBoxH(headerFill) + kBoxTR) : repeatBoxH(headerFill) + kBoxTR));
  for (const line of bodyLines) {
    const padded = padVisible(line, contentWidth);
    out.push(`${color ? style.gray(kBoxV) : kBoxV} ${padded} ${color ? style.gray(kBoxV) : kBoxV}`);
  }
  out.push(color ? style.gray(kBoxBL + repeatBoxH(borderWidth) + kBoxBR) : kBoxBL + repeatBoxH(borderWidth) + kBoxBR);
  return out;
}
function renderPlainSection(title, lines) {
  if (lines.length === 0)
    return [];
  const out = [`${title}:`];
  for (const line of lines) {
    out.push(line.length > 0 ? `  ${line}` : "");
  }
  return out;
}
function renderPlainTable(title, rows, hw) {
  if (rows.length === 0)
    return [];
  let labelWidth = 0;
  for (const row of rows) {
    labelWidth = Math.max(labelWidth, visibleWidth(row.label));
  }
  const descWidth = Math.max(20, hw - labelWidth - 4);
  const out = [`${title}:`];
  for (const row of rows) {
    const wrapped = wrapText(row.description, descWidth);
    const paddedLabel = padVisible(row.label, labelWidth);
    if (wrapped.length === 0 || wrapped[0].length === 0) {
      out.push(`  ${row.label}`);
    } else {
      out.push(`  ${paddedLabel}  ${wrapped[0]}`);
      for (let idx = 1;idx < wrapped.length; idx++) {
        out.push(`  ${spaces(labelWidth)}  ${wrapped[idx]}`);
      }
    }
  }
  return out;
}
function usageLines(appName, helpPath, hasCommands, hasArgs, documentLeaf, color, leafKind) {
  let fullPath = appName;
  for (const seg of helpPath) {
    fullPath += ` ${seg}`;
  }
  const usageOpts = color ? style.aquaBold("[OPTIONS]") : "[OPTIONS]";
  const usageCmd = color ? style.aquaBold("COMMAND") : "COMMAND";
  const usageArgs = color ? style.aquaBold("[ARGS]...") : "[ARGS]...";
  const docTag = leafKind === "document" ? "[DOCUMENT]" : "[JSON]";
  const usageDoc = color ? style.aquaBold(docTag) : docTag;
  const out = [];
  if (helpPath.length === 0) {
    if (hasCommands) {
      out.push(`${fullPath} ${usageOpts} ${usageCmd} ${usageArgs}`);
    } else {
      out.push(`${fullPath} ${usageOpts}`);
    }
    return out;
  }
  if (documentLeaf) {
    out.push(`${fullPath} ${usageDoc}`);
    return out;
  }
  out.push(`${fullPath} ${usageOpts}${hasArgs ? ` ${usageArgs}` : ""}`);
  if (hasCommands) {
    out.push(`${fullPath} ${usageCmd} ${usageArgs}`);
  }
  return out;
}
function rowsForJsonInput(inputSchema, kind) {
  const hint = "Pass a JSON or YAML document as an argument or pipe to stdin.";
  const label = kind === "document" ? "DOCUMENT" : "JSON";
  const rows = [{ label, description: hint }];
  const props = inputSchema?.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) {
    return rows;
  }
  const required = new Set(Array.isArray(inputSchema?.required) ? inputSchema.required.map((k) => String(k)) : []);
  for (const [name, prop] of Object.entries(props)) {
    const desc = prop.description ?? "";
    rows.push({
      label: name,
      description: required.has(name) ? `(required) ${desc}` : desc
    });
  }
  return rows;
}
function rowsForOptions(defs, color) {
  const rows = [];
  const helpLabel = color ? style.aquaBold("--help, ") + style.greenBright("-h") : "--help, -h";
  rows.push({ label: helpLabel, description: "Show help for this command." });
  for (const o of defs) {
    const desc = o.required ? `(required) ${o.description}` : o.description;
    rows.push({ label: cliOptionLabel(o, color), description: desc });
  }
  return rows;
}
function rowsForPositionals(defs, color) {
  return defs.map((p) => ({ label: cliPositionalLabel(p, color), description: p.description }));
}
function rowsForSubcommands(cmds) {
  return visibleSubcommands(cmds).sort((a, b) => a.key.localeCompare(b.key)).map((c) => ({ label: c.key, description: c.description }));
}
function resolveRef(ref, defs) {
  const name = ref.replace(/^#\/(definitions|\$defs)\//, "");
  const target = defs[name];
  if (typeof target === "object" && target !== null) {
    return target;
  }
  return null;
}
function formatType(schema, defs, seen) {
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace(/^#\/(definitions|\$defs)\//, "");
    if (seen.has(name)) {
      return name;
    }
    seen.add(name);
    const resolved = resolveRef(schema.$ref, defs);
    const res = resolved ? formatType(resolved, defs, seen) : name;
    seen.delete(name);
    return res;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map((v) => typeof v === "string" ? JSON.stringify(v) : String(v)).join(" | ");
  }
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union) && union.length > 0) {
    const parts = [];
    let allSimple = true;
    for (const variant of union) {
      if (typeof variant === "object" && variant !== null) {
        const formatted = formatType(variant, defs, seen);
        if (formatted !== null) {
          parts.push(formatted);
        } else {
          allSimple = false;
          break;
        }
      }
    }
    if (allSimple && parts.length > 0) {
      return parts.join(" | ");
    }
  }
  if (Array.isArray(schema.type)) {
    return schema.type.join(" | ");
  }
  if (schema.type === "string") {
    if (typeof schema.format === "string") {
      return `string (${schema.format})`;
    }
    return "string";
  }
  if (schema.type === "number")
    return "number";
  if (schema.type === "integer")
    return "integer";
  if (schema.type === "boolean")
    return "boolean";
  if (schema.type === "null")
    return "null";
  if (schema.type === "array" && schema.items && typeof schema.items === "object") {
    const itemType = formatType(schema.items, defs, seen);
    if (itemType !== null) {
      if (itemType.includes(" | ")) {
        return `(${itemType})[]`;
      }
      return `${itemType}[]`;
    }
    return null;
  }
  if (schema.type === "object" || schema.properties !== undefined) {
    if (schema.properties && typeof schema.properties === "object" && Object.keys(schema.properties).length > 0) {
      return null;
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      const valType = formatType(schema.additionalProperties, defs, seen) ?? "object";
      return `{ [key: string]: ${valType} }`;
    }
    return "object";
  }
  return null;
}
function formatSchemaLines(schema, defs, indent, seen) {
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace(/^#\/(definitions|\$defs)\//, "");
    if (seen.has(name)) {
      return [`${spaces(indent)}${name}`];
    }
    seen.add(name);
    const resolved = resolveRef(schema.$ref, defs);
    const res = resolved ? formatSchemaLines(resolved, defs, indent, seen) : [`${spaces(indent)}${name}`];
    seen.delete(name);
    return res;
  }
  if (schema.type === "object" || schema.properties !== undefined) {
    const props = schema.properties ?? {};
    const required = new Set(Array.isArray(schema.required) ? schema.required.map((k) => String(k)) : []);
    const propEntries = Object.entries(props);
    if (propEntries.length === 0) {
      const simple = formatType(schema, defs, seen);
      return simple ? [`${spaces(indent)}${simple}`] : [`${spaces(indent)}{}`];
    }
    const lines = [];
    for (const [key, prop] of propEntries) {
      if (typeof prop !== "object" || prop === null)
        continue;
      const desc = typeof prop.description === "string" ? prop.description.trim() : "";
      if (desc.length > 0) {
        for (const dLine of desc.split(`
`)) {
          lines.push(`${spaces(indent)}# ${dLine.trim()}`);
        }
      }
      const isReq = required.has(key);
      const keyStr = isReq ? key : `${key}?`;
      const simple = formatType(prop, defs, seen);
      if (simple !== null) {
        lines.push(`${spaces(indent)}${keyStr}: ${simple}`);
      } else {
        if (prop.type === "array" && prop.items && typeof prop.items === "object") {
          lines.push(`${spaces(indent)}${keyStr}:`);
          const itemSchema = prop.items;
          const itemLines = formatSchemaLines(itemSchema, defs, 0, seen);
          if (itemLines.length > 0) {
            lines.push(`${spaces(indent + 2)}- ${itemLines[0]}`);
            for (let i = 1;i < itemLines.length; i++) {
              lines.push(`${spaces(indent + 4)}${itemLines[i]}`);
            }
          } else {
            lines.push(`${spaces(indent + 2)}- {}`);
          }
        } else {
          lines.push(`${spaces(indent)}${keyStr}:`);
          const childLines = formatSchemaLines(prop, defs, indent + 2, seen);
          lines.push(...childLines);
        }
      }
    }
    return lines;
  }
  if (schema.type === "array") {
    if (schema.items && typeof schema.items === "object") {
      const itemSchema = schema.items;
      const simple = formatType(itemSchema, defs, seen);
      if (simple !== null) {
        return [`${spaces(indent)}- ${simple}`];
      }
      const itemLines = formatSchemaLines(itemSchema, defs, 0, seen);
      if (itemLines.length > 0) {
        const out = [`${spaces(indent)}- ${itemLines[0]}`];
        for (let i = 1;i < itemLines.length; i++) {
          out.push(`${spaces(indent + 2)}${itemLines[i]}`);
        }
        return out;
      }
      return [`${spaces(indent)}- {}`];
    }
    return [`${spaces(indent)}array`];
  }
  const fallback = formatType(schema, defs, seen);
  return fallback ? [`${spaces(indent)}${fallback}`] : [`${spaces(indent)}object`];
}
function schemaToYamlLines(schema, indent = 0) {
  const defs = schema.definitions ?? schema.$defs ?? {};
  const lines = [];
  if (typeof schema.description === "string" && schema.description.trim().length > 0) {
    for (const dLine of schema.description.trim().split(`
`)) {
      lines.push(`${spaces(indent)}# ${dLine.trim()}`);
    }
  }
  lines.push(...formatSchemaLines(schema, defs, indent, new Set));
  return lines;
}
function appendNotesBox(lines, notes, appKey, hw, color, isTTY) {
  if ((notes ?? "").length === 0) {
    return;
  }
  const resolved = cliResolveNotes(notes ?? "", appKey);
  lines.push("");
  if (isTTY) {
    lines.push(renderTextBox("Notes", wrapText(resolved, hw - 4), hw, color).join(`
`));
  } else {
    lines.push(renderPlainSection("Notes", wrapText(resolved, hw - 4)).join(`
`));
  }
}
function cliHelpRender(schema, helpPath, useStderr, opts) {
  const hw = getHelpWidth();
  const isTTY = opts?.isTTY ?? isOutputTTY(useStderr);
  const color = isTTY;
  const showSchema = opts?.showSchema ?? !isTTY;
  if (helpPath.length === 0) {
    const lines2 = [];
    lines2.push("");
    if (schema.description.length > 0) {
      lines2.push(color ? style.white(schema.description) : schema.description);
      lines2.push("");
    }
    const usage2 = usageLines(schema.key, helpPath, (schema.commands ?? []).length > 0, false, false, color);
    if (isTTY) {
      lines2.push(renderTextBox("Usage", usage2, hw, color).join(`
`));
    } else {
      lines2.push(renderPlainSection("Usage", usage2).join(`
`));
    }
    const optRows = rowsForOptions(visibleOptions(schema.options), color);
    const optBox = isTTY ? renderTableBox("Options", optRows, hw, color) : renderPlainTable("Options", optRows, hw);
    if (optBox.length > 0) {
      lines2.push("");
      lines2.push(optBox.join(`
`));
    }
    if ((schema.commands ?? []).length > 0) {
      const subRows2 = rowsForSubcommands(schema.commands ?? []);
      const subBox2 = isTTY ? renderTableBox("Commands", subRows2, hw, color) : renderPlainTable("Commands", subRows2, hw);
      lines2.push("");
      lines2.push(subBox2.join(`
`));
    }
    if (isCliLeaf(schema) && showSchema) {
      const leaf = schema;
      if (leaf.outputSchema !== undefined) {
        const title = isDocumentLeaf(leaf) ? "Output Schema (JSON)" : "Output Schema (with --json)";
        const yamlLines = schemaToYamlLines(leaf.outputSchema, 0);
        if (yamlLines.length > 0) {
          lines2.push("");
          if (isTTY) {
            lines2.push(renderTextBox(title, yamlLines, hw, color).join(`
`));
          } else {
            lines2.push(renderPlainSection(title, yamlLines).join(`
`));
          }
        }
      }
    }
    appendNotesBox(lines2, schema.notes, schema.key, hw, color, isTTY);
    return `${lines2.join(`
`)}

`;
  }
  let layer = schema.commands ?? [];
  let node;
  for (const seg of helpPath) {
    const ch = layer.find((c) => c.key === seg);
    if (!ch) {
      return `${color ? style.red("Unknown help path.") : "Unknown help path."}
`;
    }
    node = ch;
    layer = isCliRouter(ch) ? ch.commands : [];
  }
  if (!node) {
    return `${color ? style.red("Unknown help path.") : "Unknown help path."}
`;
  }
  const lines = [];
  lines.push("");
  if (node.description.length > 0) {
    lines.push(color ? style.white(node.description) : node.description);
    lines.push("");
  }
  const nodeIsDocumentLeaf = isCliLeaf(node) && isDocumentLeaf(node);
  const usage = usageLines(schema.key, helpPath, isCliRouter(node) && node.commands.length > 0, isCliLeaf(node) && (node.positionals ?? []).length > 0, nodeIsDocumentLeaf, color, isCliLeaf(node) ? node.kind : undefined);
  if (isTTY) {
    lines.push(renderTextBox("Usage", usage, hw, color).join(`
`));
  } else {
    lines.push(renderPlainSection("Usage", usage).join(`
`));
  }
  if (nodeIsDocumentLeaf && isCliLeaf(node)) {
    const inputRows = rowsForJsonInput(node.inputSchema, node.kind);
    const inputBox = isTTY ? renderTableBox("Input", inputRows, hw, color) : renderPlainTable("Input", inputRows, hw);
    if (inputBox.length > 0) {
      lines.push("");
      lines.push(inputBox.join(`
`));
    }
    if (showSchema && node.inputSchema !== undefined) {
      const yamlLines = schemaToYamlLines(node.inputSchema, 0);
      if (yamlLines.length > 0) {
        lines.push("");
        if (isTTY) {
          lines.push(renderTextBox("Input Schema", yamlLines, hw, color).join(`
`));
        } else {
          lines.push(renderPlainSection("Input Schema", yamlLines).join(`
`));
        }
      }
    }
  } else {
    const optRows = rowsForOptions(visibleOptions(node.options), color);
    const optBox = isTTY ? renderTableBox("Options", optRows, hw, color) : renderPlainTable("Options", optRows, hw);
    if (optBox.length > 0) {
      lines.push("");
      lines.push(optBox.join(`
`));
    }
    const posRows = rowsForPositionals(isCliLeaf(node) ? node.positionals ?? [] : [], color);
    const posBox = isTTY ? renderTableBox("Arguments", posRows, hw, color) : renderPlainTable("Arguments", posRows, hw);
    if (posBox.length > 0) {
      lines.push("");
      lines.push(posBox.join(`
`));
    }
  }
  const subcmds = isCliRouter(node) ? node.commands : [];
  const subRows = rowsForSubcommands(subcmds);
  const subBox = isTTY ? renderTableBox("Subcommands", subRows, hw, color) : renderPlainTable("Subcommands", subRows, hw);
  if (subBox.length > 0) {
    lines.push("");
    lines.push(subBox.join(`
`));
  }
  if (isCliLeaf(node) && node.outputSchema !== undefined && showSchema) {
    const title = nodeIsDocumentLeaf ? "Output Schema (JSON)" : "Output Schema (with --json)";
    const yamlLines = schemaToYamlLines(node.outputSchema, 0);
    if (yamlLines.length > 0) {
      lines.push("");
      if (isTTY) {
        lines.push(renderTextBox(title, yamlLines, hw, color).join(`
`));
      } else {
        lines.push(renderPlainSection(title, yamlLines).join(`
`));
      }
    }
  }
  if ((node.notes ?? "").length > 0) {
    appendNotesBox(lines, node.notes, schema.key, hw, color, isTTY);
  }
  return `${lines.join(`
`)}

`;
}

// ../bun-argsbarg/src/docs/cli-guide.ts
function commandPath(rootKey, path) {
  if (path.length === 0) {
    return rootKey;
  }
  return [rootKey, ...path].join(" ");
}
function optionType(opt) {
  if (opt.kind === "presence" /* Presence */) {
    return "flag";
  }
  if (opt.kind === "enum" /* Enum */) {
    return `enum (\`${(opt.choices ?? []).join("`, `")}\`)`;
  }
  return opt.kind;
}
function optionFormatDefault(opt) {
  const parts = [];
  if (opt.format !== undefined) {
    parts.push(opt.format);
  }
  if (opt.default !== undefined) {
    parts.push(`default \`${opt.default}\``);
  }
  if (opt.pattern !== undefined) {
    parts.push(`pattern \`${opt.pattern}\``);
  }
  return parts.length > 0 ? parts.join("; ") : "—";
}
function optionLabel(opt) {
  const long = `\`--${opt.name}\``;
  const short = opt.shortName ? ` (\`-${opt.shortName}\`)` : "";
  return `${long}${short}`;
}
function formatOptionRow(opt) {
  const req = opt.required ? "required" : "optional";
  return `| ${optionLabel(opt)} | ${optionType(opt)} | ${req} | ${optionFormatDefault(opt)} | ${opt.description} |`;
}
function formatPositionalRow(p) {
  const label = cliPositionalLabel(p, false);
  const req = (p.argMin ?? 1) > 0 ? "required" : "optional";
  return `| \`${label}\` | ${p.kind} | ${req} | ${p.description} |`;
}
function formatNotesBlockquote(notes, appKey) {
  const resolved = cliResolveNotes(notes, appKey);
  return resolved.split(`
`).map((line) => `> ${line}`).join(`
`);
}
function formatOutputSchemaSection(schema) {
  return [
    "#### Output",
    "",
    "JSON Schema for output when/if handler emits JSON",
    "",
    "```json",
    JSON.stringify(schema, null, 2),
    "```",
    ""
  ];
}
function fallbackLine(node) {
  if (node.fallbackCommand === undefined) {
    return null;
  }
  const mode = node.fallbackMode ?? "missingOnly" /* MissingOnly */;
  return `**Default subcommand:** \`${node.fallbackCommand}\` (\`${mode}\`)`;
}
function formatOutputSchemaPointer(rootKey) {
  return ["#### Output", "", `See \`${rootKey} docs cli-schema\` for outputSchema when set.`, ""];
}
function renderCommandNode(rootKey, path, node, lines, opts) {
  const level = Math.min(path.length + 2, 6);
  const heading = "#".repeat(level);
  const cmd = commandPath(rootKey, path);
  lines.push(`${heading} \`${cmd}\``, "", node.description, "");
  if (node.notes) {
    lines.push(formatNotesBlockquote(node.notes, rootKey), "");
  }
  const fb = fallbackLine(node);
  if (fb) {
    lines.push(fb, "");
  }
  const isJsonStyleLeaf = opts.compact && (node.options ?? []).length === 0 && (node.positionals ?? []).length === 0 && !node.commands?.length;
  if (isJsonStyleLeaf) {
    lines.push(`Input shape: see \`${rootKey} docs cli-schema\`.`, "");
  } else if ((node.options ?? []).length > 0) {
    lines.push("#### Options", "");
    lines.push("| Option | Type | Required | Format / default | Description |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const opt of node.options ?? []) {
      lines.push(formatOptionRow(opt));
    }
    lines.push("");
  }
  if ((node.positionals ?? []).length > 0) {
    lines.push("#### Positionals", "");
    lines.push("| Argument | Type | Required | Description |");
    lines.push("| --- | --- | --- | --- |");
    for (const p of node.positionals ?? []) {
      lines.push(formatPositionalRow(p));
    }
    lines.push("");
  }
  if (node.outputSchema !== undefined) {
    if (opts.compact) {
      lines.push(...formatOutputSchemaPointer(rootKey));
    } else {
      lines.push(...formatOutputSchemaSection(node.outputSchema));
    }
  }
  const children = node.commands ?? [];
  if (children.length > 0) {
    lines.push("#### Subcommands", "");
    for (const child of children) {
      lines.push(`- \`${child.key}\` — ${child.description}`);
    }
    lines.push("");
  }
  for (const child of children) {
    renderCommandNode(rootKey, [...path, child.key], child, lines, opts);
  }
}
function generateCliGuideBody(program, opts = {}) {
  const schema = cliSchemaExport(program);
  const lines = [];
  renderCommandNode(program.key, [], schema, lines, opts);
  return `${lines.join(`
`).trimEnd()}
`;
}
function generateCliGuide(program, opts = {}) {
  const schema = cliSchemaExport(program);
  const lines = [
    `# ${program.key} — CLI API reference`,
    "",
    schema.description,
    "",
    `Machine-readable export: \`${program.key} docs cli-schema\``,
    ""
  ];
  if (schema.notes) {
    lines.push(formatNotesBlockquote(schema.notes, program.key), "");
  }
  lines.push(generateCliGuideBody(program, opts).trimEnd(), "");
  return `${lines.join(`
`).trimEnd()}
`;
}

// ../bun-argsbarg/src/http/server.ts
import { randomUUID } from "node:crypto";

// ../bun-argsbarg/src/config/bootstrap.ts
import { readSync as readSync2 } from "node:fs";

// ../bun-argsbarg/src/prompt.ts
import { readSync } from "node:fs";
function readPromptLine() {
  const buf = Buffer.alloc(4096);
  const n = readSync(0, buf, { length: 4096 });
  return buf.toString("utf8", 0, n).replace(/\r?\n$/, "");
}

// ../bun-argsbarg/src/config/bindings.ts
var CONFIG_BINDINGS_KEY = "_bindings";
var BINDING_VALUES = new Set(["env", "file", "skip"]);
function isFrameworkConfigKey(key) {
  return key.startsWith("_");
}
function isPresent(value) {
  if (value === undefined || value === null)
    return false;
  if (typeof value === "string" && value.length === 0)
    return false;
  return true;
}
function readBindings(fileData) {
  const raw = fileData[CONFIG_BINDINGS_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === "string" && BINDING_VALUES.has(val)) {
      out[key] = val;
    }
  }
  return out;
}
function validateBindingsShape(fileData, pathPrefix = "$") {
  const raw = fileData[CONFIG_BINDINGS_KEY];
  if (raw === undefined)
    return [];
  const errors = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push(`${pathPrefix}.${CONFIG_BINDINGS_KEY}: must be object`);
    return errors;
  }
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val !== "string" || !BINDING_VALUES.has(val)) {
      errors.push(`${pathPrefix}.${CONFIG_BINDINGS_KEY}.${key}: must be "env", "file", or "skip"`);
    }
  }
  return errors;
}
function setBinding(fileData, key, binding) {
  const bindings = { ...readBindings(fileData), [key]: binding };
  return { ...fileData, [CONFIG_BINDINGS_KEY]: bindings };
}
function clearFileValue(fileData, key) {
  if (!(key in fileData)) {
    return fileData;
  }
  const next = { ...fileData };
  delete next[key];
  return next;
}
function isKeyAddressed(key, fileData, _entry) {
  const bindings = readBindings(fileData);
  if (bindings[key] === "skip" || bindings[key] === "env" || bindings[key] === "file") {
    return true;
  }
  return isPresent(fileData[key]);
}
function bindingForKey(key, fileData, resolvedPresent) {
  const bindings = readBindings(fileData);
  const b = bindings[key];
  if (b)
    return b;
  if (isPresent(fileData[key]))
    return "file";
  if (resolvedPresent)
    return "env";
  return "missing";
}

// ../bun-argsbarg/src/config/schema.ts
function synthesizeAllStringSchema(schema) {
  const properties = {};
  const required = [];
  for (const [key, entry] of Object.entries(schema)) {
    const prop = {
      type: "string",
      description: entry.description
    };
    if (entry.default !== undefined) {
      prop.default = entry.default;
    }
    properties[key] = prop;
    if (entry.required !== false) {
      required.push(key);
    }
  }
  const out = {
    type: "object",
    additionalProperties: false,
    properties
  };
  if (required.length > 0) {
    out.required = required;
  }
  return out;
}
function effectiveJsonSchema(program) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    return;
  }
  if (appConfig.jsonSchema !== undefined) {
    return appConfig.jsonSchema;
  }
  return synthesizeAllStringSchema(appConfig.entries);
}
function configPropertySchema(jsonSchema, key) {
  const properties = jsonSchema.properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return;
  }
  const prop = properties[key];
  if (typeof prop !== "object" || prop === null || Array.isArray(prop)) {
    return;
  }
  return prop;
}
function schemaDefaultForKey(program, key) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    return;
  }
  const entry = appConfig.entries[key];
  if (!entry) {
    return;
  }
  const jsonSchema = effectiveJsonSchema(program);
  if (jsonSchema) {
    const prop = configPropertySchema(jsonSchema, key);
    if (prop && "default" in prop) {
      return prop.default;
    }
  }
  return entry.default;
}

// ../bun-argsbarg/src/config/resolve.ts
function isPresent2(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string" && value.length === 0) {
    return false;
  }
  return true;
}
function captureMappedHostEnv(program) {
  const out = {};
  const entries = program.appConfig?.entries;
  if (!entries) {
    return out;
  }
  for (const entry of Object.values(entries)) {
    if (entry.env) {
      out[entry.env] = process.env[entry.env];
    }
  }
  return out;
}
function envOverrideValue(envName, hostEnv) {
  const val = hostEnv && envName in hostEnv ? hostEnv[envName] : process.env[envName];
  if (val === undefined || val.length === 0) {
    return;
  }
  return val;
}
function coerceEnvValue(program, key, raw) {
  const jsonSchema = effectiveJsonSchema(program);
  if (!jsonSchema) {
    return raw;
  }
  const properties = jsonSchema.properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return raw;
  }
  const prop = properties[key];
  if (typeof prop !== "object" || prop === null || Array.isArray(prop)) {
    return raw;
  }
  const type = prop.type;
  if (type === "number" || type === "integer") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (type === "boolean") {
    const lower = raw.toLowerCase();
    if (lower === "true" || lower === "1")
      return true;
    if (lower === "false" || lower === "0")
      return false;
  }
  return raw;
}
function resolveAppConfig(program, fileData, hostEnv) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    return {};
  }
  const out = {};
  for (const [key, entry] of Object.entries(appConfig.entries)) {
    const value = resolveConfigKey(program, key, entry, fileData, hostEnv);
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
function tryEnvOverride(program, key, entry, hostEnv) {
  if (!entry.env) {
    return;
  }
  const fromEnv = envOverrideValue(entry.env, hostEnv);
  if (fromEnv === undefined) {
    return;
  }
  return coerceEnvValue(program, key, fromEnv);
}
function buildResolveContext(program, key, entry, fileData, hostEnv) {
  return {
    key,
    entry,
    program,
    fileValue: fileData[key],
    envValue: entry.env ? envOverrideValue(entry.env, hostEnv) : undefined
  };
}
function resolveConfigKey(program, key, entry, fileData, hostEnv) {
  const fromEnv = tryEnvOverride(program, key, entry, hostEnv);
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  if (key in fileData && isPresent2(fileData[key])) {
    return fileData[key];
  }
  if (entry.resolve) {
    const fromResolve = entry.resolve(buildResolveContext(program, key, entry, fileData, hostEnv));
    if (fromResolve != null && typeof fromResolve.then === "function") {
      process.stderr.write(`[argsbarg] config "${key}": resolve() returned a Promise; use a synchronous resolver (e.g. Bun.spawnSync with piped stdout).
`);
    } else if (isPresent2(fromResolve)) {
      return fromResolve;
    }
  }
  const fromEnvFallback = tryEnvOverride(program, key, entry, hostEnv);
  if (fromEnvFallback !== undefined) {
    return fromEnvFallback;
  }
  const def = schemaDefaultForKey(program, key);
  if (def !== undefined) {
    return def;
  }
  return;
}
function exportConfigToEnv(program, resolved, hostEnv) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    return;
  }
  for (const [key, entry] of Object.entries(appConfig.entries)) {
    if (!entry.env) {
      continue;
    }
    const captured = hostEnv?.[entry.env];
    if (captured !== undefined && captured.length > 0) {
      continue;
    }
    const existing = process.env[entry.env];
    if (existing !== undefined && existing.length > 0) {
      continue;
    }
    const value = resolved[key];
    if (!isPresent2(value)) {
      continue;
    }
    process.env[entry.env] = stringifyConfigValue(value);
  }
}
function stringifyConfigValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
function missingRequiredConfig(program, resolved) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    return [];
  }
  const jsonSchema = effectiveJsonSchema(program);
  const fromSchema = jsonSchema ? jsonSchemaRequiredKeys(jsonSchema) : undefined;
  const missing = [];
  for (const [key, entry] of Object.entries(appConfig.entries)) {
    if (!configEntryRequired(key, entry, fromSchema)) {
      continue;
    }
    if (!isPresent2(resolved[key])) {
      missing.push(key);
    }
  }
  return missing;
}
function formatMissingConfigMessage(program, keys) {
  const list = keys.join(", ");
  const path = displayAppConfigPath(program);
  return [
    `Missing required configuration: ${list}`,
    `Configure interactively:  ${program.key} configure install`,
    `Or set via:               ${program.key} configure set <key> <value>`,
    `Config file:              ${path}`,
    `See:                      ${program.key} docs mcp`
  ].join(`
`);
}
function formatMcpMissingConfigMessage(program, keys) {
  const list = keys.join(", ");
  const path = displayAppConfigPath(program);
  return [
    `Missing required configuration: ${list}`,
    `Configure: ${program.key} configure`,
    `Or set via: ${program.key} configure set`,
    `Config file: ${path}`
  ].join(`
`);
}

// ../bun-argsbarg/node_modules/@cfworker/json-schema/dist/esm/deep-compare-strict.js
function deepCompareStrict(a, b) {
  const typeofa = typeof a;
  if (typeofa !== typeof b) {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) {
      return false;
    }
    const length = a.length;
    if (length !== b.length) {
      return false;
    }
    for (let i = 0;i < length; i++) {
      if (!deepCompareStrict(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (typeofa === "object") {
    if (!a || !b) {
      return a === b;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    const length = aKeys.length;
    if (length !== bKeys.length) {
      return false;
    }
    for (const k of aKeys) {
      if (!deepCompareStrict(a[k], b[k])) {
        return false;
      }
    }
    return true;
  }
  return a === b;
}

// ../bun-argsbarg/node_modules/@cfworker/json-schema/dist/esm/pointer.js
function encodePointer(p) {
  return encodeURI(escapePointer(p));
}
function escapePointer(p) {
  return p.replace(/~/g, "~0").replace(/\//g, "~1");
}

// ../bun-argsbarg/node_modules/@cfworker/json-schema/dist/esm/dereference.js
var schemaArrayKeyword = {
  prefixItems: true,
  items: true,
  allOf: true,
  anyOf: true,
  oneOf: true
};
var schemaMapKeyword = {
  $defs: true,
  definitions: true,
  properties: true,
  patternProperties: true,
  dependentSchemas: true
};
var ignoredKeyword = {
  id: true,
  $id: true,
  $ref: true,
  $schema: true,
  $anchor: true,
  $vocabulary: true,
  $comment: true,
  default: true,
  enum: true,
  const: true,
  required: true,
  type: true,
  maximum: true,
  minimum: true,
  exclusiveMaximum: true,
  exclusiveMinimum: true,
  multipleOf: true,
  maxLength: true,
  minLength: true,
  pattern: true,
  format: true,
  maxItems: true,
  minItems: true,
  uniqueItems: true,
  maxProperties: true,
  minProperties: true
};
var initialBaseURI = typeof self !== "undefined" && self.location && self.location.origin !== "null" ? new URL(self.location.origin + self.location.pathname + location.search) : new URL("https://github.com/cfworker");
function dereference(schema, lookup = Object.create(null), baseURI = initialBaseURI, basePointer = "") {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const id = schema.$id || schema.id;
    if (id) {
      const url = new URL(id, baseURI.href);
      if (url.hash.length > 1) {
        lookup[url.href] = schema;
      } else {
        url.hash = "";
        if (basePointer === "") {
          baseURI = url;
        } else {
          dereference(schema, lookup, baseURI);
        }
      }
    }
  } else if (schema !== true && schema !== false) {
    return lookup;
  }
  const schemaURI = baseURI.href + (basePointer ? "#" + basePointer : "");
  if (lookup[schemaURI] !== undefined) {
    throw new Error(`Duplicate schema URI "${schemaURI}".`);
  }
  lookup[schemaURI] = schema;
  if (schema === true || schema === false) {
    return lookup;
  }
  if (schema.__absolute_uri__ === undefined) {
    Object.defineProperty(schema, "__absolute_uri__", {
      enumerable: false,
      value: schemaURI
    });
  }
  if (schema.$ref && schema.__absolute_ref__ === undefined) {
    const url = new URL(schema.$ref, baseURI.href);
    url.hash = url.hash;
    Object.defineProperty(schema, "__absolute_ref__", {
      enumerable: false,
      value: url.href
    });
  }
  if (schema.$recursiveRef && schema.__absolute_recursive_ref__ === undefined) {
    const url = new URL(schema.$recursiveRef, baseURI.href);
    url.hash = url.hash;
    Object.defineProperty(schema, "__absolute_recursive_ref__", {
      enumerable: false,
      value: url.href
    });
  }
  if (schema.$anchor) {
    const url = new URL("#" + schema.$anchor, baseURI.href);
    lookup[url.href] = schema;
  }
  for (let key in schema) {
    if (ignoredKeyword[key]) {
      continue;
    }
    const keyBase = `${basePointer}/${encodePointer(key)}`;
    const subSchema = schema[key];
    if (Array.isArray(subSchema)) {
      if (schemaArrayKeyword[key]) {
        const length = subSchema.length;
        for (let i = 0;i < length; i++) {
          dereference(subSchema[i], lookup, baseURI, `${keyBase}/${i}`);
        }
      }
    } else if (schemaMapKeyword[key]) {
      for (let subKey in subSchema) {
        dereference(subSchema[subKey], lookup, baseURI, `${keyBase}/${encodePointer(subKey)}`);
      }
    } else {
      dereference(subSchema, lookup, baseURI, keyBase);
    }
  }
  return lookup;
}

// ../bun-argsbarg/node_modules/@cfworker/json-schema/dist/esm/format.js
var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var TIME = /^(\d\d):(\d\d):(\d\d)(\.\d+)?(z|[+-]\d\d(?::?\d\d)?)?$/i;
var HOSTNAME = /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i;
var URIREF = /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
var URITEMPLATE = /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i;
var URL_ = /^(?:(?:https?|ftp):\/\/)(?:\S+(?::\S*)?@)?(?:(?!10(?:\.\d{1,3}){3})(?!127(?:\.\d{1,3}){3})(?!169\.254(?:\.\d{1,3}){2})(?!192\.168(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u{00a1}-\u{ffff}0-9]+-?)*[a-z\u{00a1}-\u{ffff}0-9]+)(?:\.(?:[a-z\u{00a1}-\u{ffff}0-9]+-?)*[a-z\u{00a1}-\u{ffff}0-9]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu;
var UUID = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
var JSON_POINTER = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
var JSON_POINTER_URI_FRAGMENT = /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i;
var RELATIVE_JSON_POINTER = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/;
var EMAIL = (input) => {
  if (input[0] === '"')
    return false;
  const [name, host, ...rest] = input.split("@");
  if (!name || !host || rest.length !== 0 || name.length > 64 || host.length > 253)
    return false;
  if (name[0] === "." || name.endsWith(".") || name.includes(".."))
    return false;
  if (!/^[a-z0-9.-]+$/i.test(host) || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(name))
    return false;
  return host.split(".").every((part) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
};
var IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
var IPV6 = /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i;
var DURATION = (input) => input.length > 1 && input.length < 80 && (/^P\d+([.,]\d+)?W$/.test(input) || /^P[\dYMDTHS]*(\d[.,]\d+)?[YMDHS]$/.test(input) && /^P([.,\d]+Y)?([.,\d]+M)?([.,\d]+D)?(T([.,\d]+H)?([.,\d]+M)?([.,\d]+S)?)?$/.test(input));
function bind(r) {
  return r.test.bind(r);
}
var format = {
  date,
  time: time.bind(undefined, false),
  "date-time": date_time,
  duration: DURATION,
  uri,
  "uri-reference": bind(URIREF),
  "uri-template": bind(URITEMPLATE),
  url: bind(URL_),
  email: EMAIL,
  hostname: bind(HOSTNAME),
  ipv4: bind(IPV4),
  ipv6: bind(IPV6),
  regex,
  uuid: bind(UUID),
  "json-pointer": bind(JSON_POINTER),
  "json-pointer-uri-fragment": bind(JSON_POINTER_URI_FRAGMENT),
  "relative-json-pointer": bind(RELATIVE_JSON_POINTER)
};
function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function date(str) {
  const matches = str.match(DATE);
  if (!matches)
    return false;
  const year = +matches[1];
  const month = +matches[2];
  const day = +matches[3];
  return month >= 1 && month <= 12 && day >= 1 && day <= (month == 2 && isLeapYear(year) ? 29 : DAYS[month]);
}
function time(full, str) {
  const matches = str.match(TIME);
  if (!matches)
    return false;
  const hour = +matches[1];
  const minute = +matches[2];
  const second = +matches[3];
  const timeZone = !!matches[5];
  return (hour <= 23 && minute <= 59 && second <= 59 || hour == 23 && minute == 59 && second == 60) && (!full || timeZone);
}
var DATE_TIME_SEPARATOR = /t|\s/i;
function date_time(str) {
  const dateTime = str.split(DATE_TIME_SEPARATOR);
  return dateTime.length == 2 && date(dateTime[0]) && time(true, dateTime[1]);
}
var NOT_URI_FRAGMENT = /\/|:/;
var URI_PATTERN = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
function uri(str) {
  return NOT_URI_FRAGMENT.test(str) && URI_PATTERN.test(str);
}
var Z_ANCHOR = /[^\\]\\Z/;
function regex(str) {
  if (Z_ANCHOR.test(str))
    return false;
  try {
    new RegExp(str, "u");
    return true;
  } catch (e) {
    return false;
  }
}

// ../bun-argsbarg/node_modules/@cfworker/json-schema/dist/esm/ucs2-length.js
function ucs2length(s) {
  let result = 0;
  let length = s.length;
  let index = 0;
  let charCode;
  while (index < length) {
    result++;
    charCode = s.charCodeAt(index++);
    if (charCode >= 55296 && charCode <= 56319 && index < length) {
      charCode = s.charCodeAt(index);
      if ((charCode & 64512) == 56320) {
        index++;
      }
    }
  }
  return result;
}

// ../bun-argsbarg/node_modules/@cfworker/json-schema/dist/esm/validate.js
function validate(instance, schema, draft = "2019-09", lookup = dereference(schema), shortCircuit = true, recursiveAnchor = null, instanceLocation = "#", schemaLocation = "#", evaluated = Object.create(null)) {
  if (schema === true) {
    return { valid: true, errors: [] };
  }
  if (schema === false) {
    return {
      valid: false,
      errors: [
        {
          instanceLocation,
          keyword: "false",
          keywordLocation: instanceLocation,
          error: "False boolean schema."
        }
      ]
    };
  }
  const rawInstanceType = typeof instance;
  let instanceType;
  switch (rawInstanceType) {
    case "boolean":
    case "number":
    case "string":
      instanceType = rawInstanceType;
      break;
    case "object":
      if (instance === null) {
        instanceType = "null";
      } else if (Array.isArray(instance)) {
        instanceType = "array";
      } else {
        instanceType = "object";
      }
      break;
    default:
      throw new Error(`Instances of "${rawInstanceType}" type are not supported.`);
  }
  const { $ref, $recursiveRef, $recursiveAnchor, type: $type, const: $const, enum: $enum, required: $required, not: $not, anyOf: $anyOf, allOf: $allOf, oneOf: $oneOf, if: $if, then: $then, else: $else, format: $format, properties: $properties, patternProperties: $patternProperties, additionalProperties: $additionalProperties, unevaluatedProperties: $unevaluatedProperties, minProperties: $minProperties, maxProperties: $maxProperties, propertyNames: $propertyNames, dependentRequired: $dependentRequired, dependentSchemas: $dependentSchemas, dependencies: $dependencies, prefixItems: $prefixItems, items: $items, additionalItems: $additionalItems, unevaluatedItems: $unevaluatedItems, contains: $contains, minContains: $minContains, maxContains: $maxContains, minItems: $minItems, maxItems: $maxItems, uniqueItems: $uniqueItems, minimum: $minimum, maximum: $maximum, exclusiveMinimum: $exclusiveMinimum, exclusiveMaximum: $exclusiveMaximum, multipleOf: $multipleOf, minLength: $minLength, maxLength: $maxLength, pattern: $pattern, __absolute_ref__, __absolute_recursive_ref__ } = schema;
  const errors = [];
  if ($recursiveAnchor === true && recursiveAnchor === null) {
    recursiveAnchor = schema;
  }
  if ($recursiveRef === "#") {
    const refSchema = recursiveAnchor === null ? lookup[__absolute_recursive_ref__] : recursiveAnchor;
    const keywordLocation = `${schemaLocation}/$recursiveRef`;
    const result = validate(instance, recursiveAnchor === null ? schema : recursiveAnchor, draft, lookup, shortCircuit, refSchema, instanceLocation, keywordLocation, evaluated);
    if (!result.valid) {
      errors.push({
        instanceLocation,
        keyword: "$recursiveRef",
        keywordLocation,
        error: "A subschema had errors."
      }, ...result.errors);
    }
  }
  if ($ref !== undefined) {
    const uri2 = __absolute_ref__ || $ref;
    const refSchema = lookup[uri2];
    if (refSchema === undefined) {
      let message = `Unresolved $ref "${$ref}".`;
      if (__absolute_ref__ && __absolute_ref__ !== $ref) {
        message += `  Absolute URI "${__absolute_ref__}".`;
      }
      message += `
Known schemas:
- ${Object.keys(lookup).join(`
- `)}`;
      throw new Error(message);
    }
    const keywordLocation = `${schemaLocation}/$ref`;
    const result = validate(instance, refSchema, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation, evaluated);
    if (!result.valid) {
      errors.push({
        instanceLocation,
        keyword: "$ref",
        keywordLocation,
        error: "A subschema had errors."
      }, ...result.errors);
    }
    if (draft === "4" || draft === "7") {
      return { valid: errors.length === 0, errors };
    }
  }
  if (Array.isArray($type)) {
    let length = $type.length;
    let valid = false;
    for (let i = 0;i < length; i++) {
      if (instanceType === $type[i] || $type[i] === "integer" && instanceType === "number" && instance % 1 === 0 && instance === instance) {
        valid = true;
        break;
      }
    }
    if (!valid) {
      errors.push({
        instanceLocation,
        keyword: "type",
        keywordLocation: `${schemaLocation}/type`,
        error: `Instance type "${instanceType}" is invalid. Expected "${$type.join('", "')}".`
      });
    }
  } else if ($type === "integer") {
    if (instanceType !== "number" || instance % 1 || instance !== instance) {
      errors.push({
        instanceLocation,
        keyword: "type",
        keywordLocation: `${schemaLocation}/type`,
        error: `Instance type "${instanceType}" is invalid. Expected "${$type}".`
      });
    }
  } else if ($type !== undefined && instanceType !== $type) {
    errors.push({
      instanceLocation,
      keyword: "type",
      keywordLocation: `${schemaLocation}/type`,
      error: `Instance type "${instanceType}" is invalid. Expected "${$type}".`
    });
  }
  if ($const !== undefined) {
    if (instanceType === "object" || instanceType === "array") {
      if (!deepCompareStrict(instance, $const)) {
        errors.push({
          instanceLocation,
          keyword: "const",
          keywordLocation: `${schemaLocation}/const`,
          error: `Instance does not match ${JSON.stringify($const)}.`
        });
      }
    } else if (instance !== $const) {
      errors.push({
        instanceLocation,
        keyword: "const",
        keywordLocation: `${schemaLocation}/const`,
        error: `Instance does not match ${JSON.stringify($const)}.`
      });
    }
  }
  if ($enum !== undefined) {
    if (instanceType === "object" || instanceType === "array") {
      if (!$enum.some((value) => deepCompareStrict(instance, value))) {
        errors.push({
          instanceLocation,
          keyword: "enum",
          keywordLocation: `${schemaLocation}/enum`,
          error: `Instance does not match any of ${JSON.stringify($enum)}.`
        });
      }
    } else if (!$enum.some((value) => instance === value)) {
      errors.push({
        instanceLocation,
        keyword: "enum",
        keywordLocation: `${schemaLocation}/enum`,
        error: `Instance does not match any of ${JSON.stringify($enum)}.`
      });
    }
  }
  if ($not !== undefined) {
    const keywordLocation = `${schemaLocation}/not`;
    const result = validate(instance, $not, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation);
    if (result.valid) {
      errors.push({
        instanceLocation,
        keyword: "not",
        keywordLocation,
        error: 'Instance matched "not" schema.'
      });
    }
  }
  let subEvaluateds = [];
  if ($anyOf !== undefined) {
    const keywordLocation = `${schemaLocation}/anyOf`;
    const errorsLength = errors.length;
    let anyValid = false;
    for (let i = 0;i < $anyOf.length; i++) {
      const subSchema = $anyOf[i];
      const subEvaluated = Object.create(evaluated);
      const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
      errors.push(...result.errors);
      anyValid = anyValid || result.valid;
      if (result.valid) {
        subEvaluateds.push(subEvaluated);
      }
    }
    if (anyValid) {
      errors.length = errorsLength;
    } else {
      errors.splice(errorsLength, 0, {
        instanceLocation,
        keyword: "anyOf",
        keywordLocation,
        error: "Instance does not match any subschemas."
      });
    }
  }
  if ($allOf !== undefined) {
    const keywordLocation = `${schemaLocation}/allOf`;
    const errorsLength = errors.length;
    let allValid = true;
    for (let i = 0;i < $allOf.length; i++) {
      const subSchema = $allOf[i];
      const subEvaluated = Object.create(evaluated);
      const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
      errors.push(...result.errors);
      allValid = allValid && result.valid;
      if (result.valid) {
        subEvaluateds.push(subEvaluated);
      }
    }
    if (allValid) {
      errors.length = errorsLength;
    } else {
      errors.splice(errorsLength, 0, {
        instanceLocation,
        keyword: "allOf",
        keywordLocation,
        error: `Instance does not match every subschema.`
      });
    }
  }
  if ($oneOf !== undefined) {
    const keywordLocation = `${schemaLocation}/oneOf`;
    const errorsLength = errors.length;
    const matches = $oneOf.filter((subSchema, i) => {
      const subEvaluated = Object.create(evaluated);
      const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
      errors.push(...result.errors);
      if (result.valid) {
        subEvaluateds.push(subEvaluated);
      }
      return result.valid;
    }).length;
    if (matches === 1) {
      errors.length = errorsLength;
    } else {
      errors.splice(errorsLength, 0, {
        instanceLocation,
        keyword: "oneOf",
        keywordLocation,
        error: `Instance does not match exactly one subschema (${matches} matches).`
      });
    }
  }
  if (instanceType === "object" || instanceType === "array") {
    Object.assign(evaluated, ...subEvaluateds);
  }
  if ($if !== undefined) {
    const keywordLocation = `${schemaLocation}/if`;
    const conditionResult = validate(instance, $if, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation, evaluated).valid;
    if (conditionResult) {
      if ($then !== undefined) {
        const thenResult = validate(instance, $then, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${schemaLocation}/then`, evaluated);
        if (!thenResult.valid) {
          errors.push({
            instanceLocation,
            keyword: "if",
            keywordLocation,
            error: `Instance does not match "then" schema.`
          }, ...thenResult.errors);
        }
      }
    } else if ($else !== undefined) {
      const elseResult = validate(instance, $else, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${schemaLocation}/else`, evaluated);
      if (!elseResult.valid) {
        errors.push({
          instanceLocation,
          keyword: "if",
          keywordLocation,
          error: `Instance does not match "else" schema.`
        }, ...elseResult.errors);
      }
    }
  }
  if (instanceType === "object") {
    if ($required !== undefined) {
      for (const key of $required) {
        if (!(key in instance)) {
          errors.push({
            instanceLocation,
            keyword: "required",
            keywordLocation: `${schemaLocation}/required`,
            error: `Instance does not have required property "${key}".`
          });
        }
      }
    }
    const keys = Object.keys(instance);
    if ($minProperties !== undefined && keys.length < $minProperties) {
      errors.push({
        instanceLocation,
        keyword: "minProperties",
        keywordLocation: `${schemaLocation}/minProperties`,
        error: `Instance does not have at least ${$minProperties} properties.`
      });
    }
    if ($maxProperties !== undefined && keys.length > $maxProperties) {
      errors.push({
        instanceLocation,
        keyword: "maxProperties",
        keywordLocation: `${schemaLocation}/maxProperties`,
        error: `Instance does not have at least ${$maxProperties} properties.`
      });
    }
    if ($propertyNames !== undefined) {
      const keywordLocation = `${schemaLocation}/propertyNames`;
      for (const key in instance) {
        const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
        const result = validate(key, $propertyNames, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
        if (!result.valid) {
          errors.push({
            instanceLocation,
            keyword: "propertyNames",
            keywordLocation,
            error: `Property name "${key}" does not match schema.`
          }, ...result.errors);
        }
      }
    }
    if ($dependentRequired !== undefined) {
      const keywordLocation = `${schemaLocation}/dependantRequired`;
      for (const key in $dependentRequired) {
        if (key in instance) {
          const required = $dependentRequired[key];
          for (const dependantKey of required) {
            if (!(dependantKey in instance)) {
              errors.push({
                instanceLocation,
                keyword: "dependentRequired",
                keywordLocation,
                error: `Instance has "${key}" but does not have "${dependantKey}".`
              });
            }
          }
        }
      }
    }
    if ($dependentSchemas !== undefined) {
      for (const key in $dependentSchemas) {
        const keywordLocation = `${schemaLocation}/dependentSchemas`;
        if (key in instance) {
          const result = validate(instance, $dependentSchemas[key], draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${keywordLocation}/${encodePointer(key)}`, evaluated);
          if (!result.valid) {
            errors.push({
              instanceLocation,
              keyword: "dependentSchemas",
              keywordLocation,
              error: `Instance has "${key}" but does not match dependant schema.`
            }, ...result.errors);
          }
        }
      }
    }
    if ($dependencies !== undefined) {
      const keywordLocation = `${schemaLocation}/dependencies`;
      for (const key in $dependencies) {
        if (key in instance) {
          const propsOrSchema = $dependencies[key];
          if (Array.isArray(propsOrSchema)) {
            for (const dependantKey of propsOrSchema) {
              if (!(dependantKey in instance)) {
                errors.push({
                  instanceLocation,
                  keyword: "dependencies",
                  keywordLocation,
                  error: `Instance has "${key}" but does not have "${dependantKey}".`
                });
              }
            }
          } else {
            const result = validate(instance, propsOrSchema, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${keywordLocation}/${encodePointer(key)}`);
            if (!result.valid) {
              errors.push({
                instanceLocation,
                keyword: "dependencies",
                keywordLocation,
                error: `Instance has "${key}" but does not match dependant schema.`
              }, ...result.errors);
            }
          }
        }
      }
    }
    const thisEvaluated = Object.create(null);
    let stop = false;
    if ($properties !== undefined) {
      const keywordLocation = `${schemaLocation}/properties`;
      for (const key in $properties) {
        if (!(key in instance)) {
          continue;
        }
        const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
        const result = validate(instance[key], $properties[key], draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, `${keywordLocation}/${encodePointer(key)}`);
        if (result.valid) {
          evaluated[key] = thisEvaluated[key] = true;
        } else {
          stop = shortCircuit;
          errors.push({
            instanceLocation,
            keyword: "properties",
            keywordLocation,
            error: `Property "${key}" does not match schema.`
          }, ...result.errors);
          if (stop)
            break;
        }
      }
    }
    if (!stop && $patternProperties !== undefined) {
      const keywordLocation = `${schemaLocation}/patternProperties`;
      for (const pattern in $patternProperties) {
        const regex2 = new RegExp(pattern, "u");
        const subSchema = $patternProperties[pattern];
        for (const key in instance) {
          if (!regex2.test(key)) {
            continue;
          }
          const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
          const result = validate(instance[key], subSchema, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, `${keywordLocation}/${encodePointer(pattern)}`);
          if (result.valid) {
            evaluated[key] = thisEvaluated[key] = true;
          } else {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "patternProperties",
              keywordLocation,
              error: `Property "${key}" matches pattern "${pattern}" but does not match associated schema.`
            }, ...result.errors);
          }
        }
      }
    }
    if (!stop && $additionalProperties !== undefined) {
      const keywordLocation = `${schemaLocation}/additionalProperties`;
      for (const key in instance) {
        if (thisEvaluated[key]) {
          continue;
        }
        const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
        const result = validate(instance[key], $additionalProperties, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
        if (result.valid) {
          evaluated[key] = true;
        } else {
          stop = shortCircuit;
          errors.push({
            instanceLocation,
            keyword: "additionalProperties",
            keywordLocation,
            error: `Property "${key}" does not match additional properties schema.`
          }, ...result.errors);
        }
      }
    } else if (!stop && $unevaluatedProperties !== undefined) {
      const keywordLocation = `${schemaLocation}/unevaluatedProperties`;
      for (const key in instance) {
        if (!evaluated[key]) {
          const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
          const result = validate(instance[key], $unevaluatedProperties, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
          if (result.valid) {
            evaluated[key] = true;
          } else {
            errors.push({
              instanceLocation,
              keyword: "unevaluatedProperties",
              keywordLocation,
              error: `Property "${key}" does not match unevaluated properties schema.`
            }, ...result.errors);
          }
        }
      }
    }
  } else if (instanceType === "array") {
    if ($maxItems !== undefined && instance.length > $maxItems) {
      errors.push({
        instanceLocation,
        keyword: "maxItems",
        keywordLocation: `${schemaLocation}/maxItems`,
        error: `Array has too many items (${instance.length} > ${$maxItems}).`
      });
    }
    if ($minItems !== undefined && instance.length < $minItems) {
      errors.push({
        instanceLocation,
        keyword: "minItems",
        keywordLocation: `${schemaLocation}/minItems`,
        error: `Array has too few items (${instance.length} < ${$minItems}).`
      });
    }
    const length = instance.length;
    let i = 0;
    let stop = false;
    if ($prefixItems !== undefined) {
      const keywordLocation = `${schemaLocation}/prefixItems`;
      const length2 = Math.min($prefixItems.length, length);
      for (;i < length2; i++) {
        const result = validate(instance[i], $prefixItems[i], draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, `${keywordLocation}/${i}`);
        evaluated[i] = true;
        if (!result.valid) {
          stop = shortCircuit;
          errors.push({
            instanceLocation,
            keyword: "prefixItems",
            keywordLocation,
            error: `Items did not match schema.`
          }, ...result.errors);
          if (stop)
            break;
        }
      }
    }
    if ($items !== undefined) {
      const keywordLocation = `${schemaLocation}/items`;
      if (Array.isArray($items)) {
        const length2 = Math.min($items.length, length);
        for (;i < length2; i++) {
          const result = validate(instance[i], $items[i], draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, `${keywordLocation}/${i}`);
          evaluated[i] = true;
          if (!result.valid) {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "items",
              keywordLocation,
              error: `Items did not match schema.`
            }, ...result.errors);
            if (stop)
              break;
          }
        }
      } else {
        for (;i < length; i++) {
          const result = validate(instance[i], $items, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation);
          evaluated[i] = true;
          if (!result.valid) {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "items",
              keywordLocation,
              error: `Items did not match schema.`
            }, ...result.errors);
            if (stop)
              break;
          }
        }
      }
      if (!stop && $additionalItems !== undefined) {
        const keywordLocation2 = `${schemaLocation}/additionalItems`;
        for (;i < length; i++) {
          const result = validate(instance[i], $additionalItems, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation2);
          evaluated[i] = true;
          if (!result.valid) {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "additionalItems",
              keywordLocation: keywordLocation2,
              error: `Items did not match additional items schema.`
            }, ...result.errors);
          }
        }
      }
    }
    if ($contains !== undefined) {
      if (length === 0 && $minContains === undefined) {
        errors.push({
          instanceLocation,
          keyword: "contains",
          keywordLocation: `${schemaLocation}/contains`,
          error: `Array is empty. It must contain at least one item matching the schema.`
        });
      } else if ($minContains !== undefined && length < $minContains) {
        errors.push({
          instanceLocation,
          keyword: "minContains",
          keywordLocation: `${schemaLocation}/minContains`,
          error: `Array has less items (${length}) than minContains (${$minContains}).`
        });
      } else {
        const keywordLocation = `${schemaLocation}/contains`;
        const errorsLength = errors.length;
        let contained = 0;
        for (let j = 0;j < length; j++) {
          const result = validate(instance[j], $contains, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${j}`, keywordLocation);
          if (result.valid) {
            evaluated[j] = true;
            contained++;
          } else {
            errors.push(...result.errors);
          }
        }
        if (contained >= ($minContains || 0)) {
          errors.length = errorsLength;
        }
        if ($minContains === undefined && $maxContains === undefined && contained === 0) {
          errors.splice(errorsLength, 0, {
            instanceLocation,
            keyword: "contains",
            keywordLocation,
            error: `Array does not contain item matching schema.`
          });
        } else if ($minContains !== undefined && contained < $minContains) {
          errors.push({
            instanceLocation,
            keyword: "minContains",
            keywordLocation: `${schemaLocation}/minContains`,
            error: `Array must contain at least ${$minContains} items matching schema. Only ${contained} items were found.`
          });
        } else if ($maxContains !== undefined && contained > $maxContains) {
          errors.push({
            instanceLocation,
            keyword: "maxContains",
            keywordLocation: `${schemaLocation}/maxContains`,
            error: `Array may contain at most ${$maxContains} items matching schema. ${contained} items were found.`
          });
        }
      }
    }
    if (!stop && $unevaluatedItems !== undefined) {
      const keywordLocation = `${schemaLocation}/unevaluatedItems`;
      for (i;i < length; i++) {
        if (evaluated[i]) {
          continue;
        }
        const result = validate(instance[i], $unevaluatedItems, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation);
        evaluated[i] = true;
        if (!result.valid) {
          errors.push({
            instanceLocation,
            keyword: "unevaluatedItems",
            keywordLocation,
            error: `Items did not match unevaluated items schema.`
          }, ...result.errors);
        }
      }
    }
    if ($uniqueItems) {
      for (let j = 0;j < length; j++) {
        const a = instance[j];
        const ao = typeof a === "object" && a !== null;
        for (let k = 0;k < length; k++) {
          if (j === k) {
            continue;
          }
          const b = instance[k];
          const bo = typeof b === "object" && b !== null;
          if (a === b || ao && bo && deepCompareStrict(a, b)) {
            errors.push({
              instanceLocation,
              keyword: "uniqueItems",
              keywordLocation: `${schemaLocation}/uniqueItems`,
              error: `Duplicate items at indexes ${j} and ${k}.`
            });
            j = Number.MAX_SAFE_INTEGER;
            k = Number.MAX_SAFE_INTEGER;
          }
        }
      }
    }
  } else if (instanceType === "number") {
    if (draft === "4") {
      if ($minimum !== undefined && ($exclusiveMinimum === true && instance <= $minimum || instance < $minimum)) {
        errors.push({
          instanceLocation,
          keyword: "minimum",
          keywordLocation: `${schemaLocation}/minimum`,
          error: `${instance} is less than ${$exclusiveMinimum ? "or equal to " : ""} ${$minimum}.`
        });
      }
      if ($maximum !== undefined && ($exclusiveMaximum === true && instance >= $maximum || instance > $maximum)) {
        errors.push({
          instanceLocation,
          keyword: "maximum",
          keywordLocation: `${schemaLocation}/maximum`,
          error: `${instance} is greater than ${$exclusiveMaximum ? "or equal to " : ""} ${$maximum}.`
        });
      }
    } else {
      if ($minimum !== undefined && instance < $minimum) {
        errors.push({
          instanceLocation,
          keyword: "minimum",
          keywordLocation: `${schemaLocation}/minimum`,
          error: `${instance} is less than ${$minimum}.`
        });
      }
      if ($maximum !== undefined && instance > $maximum) {
        errors.push({
          instanceLocation,
          keyword: "maximum",
          keywordLocation: `${schemaLocation}/maximum`,
          error: `${instance} is greater than ${$maximum}.`
        });
      }
      if ($exclusiveMinimum !== undefined && instance <= $exclusiveMinimum) {
        errors.push({
          instanceLocation,
          keyword: "exclusiveMinimum",
          keywordLocation: `${schemaLocation}/exclusiveMinimum`,
          error: `${instance} is less than ${$exclusiveMinimum}.`
        });
      }
      if ($exclusiveMaximum !== undefined && instance >= $exclusiveMaximum) {
        errors.push({
          instanceLocation,
          keyword: "exclusiveMaximum",
          keywordLocation: `${schemaLocation}/exclusiveMaximum`,
          error: `${instance} is greater than or equal to ${$exclusiveMaximum}.`
        });
      }
    }
    if ($multipleOf !== undefined) {
      const remainder = instance % $multipleOf;
      if (Math.abs(0 - remainder) >= 0.00000011920929 && Math.abs($multipleOf - remainder) >= 0.00000011920929) {
        errors.push({
          instanceLocation,
          keyword: "multipleOf",
          keywordLocation: `${schemaLocation}/multipleOf`,
          error: `${instance} is not a multiple of ${$multipleOf}.`
        });
      }
    }
  } else if (instanceType === "string") {
    const length = $minLength === undefined && $maxLength === undefined ? 0 : ucs2length(instance);
    if ($minLength !== undefined && length < $minLength) {
      errors.push({
        instanceLocation,
        keyword: "minLength",
        keywordLocation: `${schemaLocation}/minLength`,
        error: `String is too short (${length} < ${$minLength}).`
      });
    }
    if ($maxLength !== undefined && length > $maxLength) {
      errors.push({
        instanceLocation,
        keyword: "maxLength",
        keywordLocation: `${schemaLocation}/maxLength`,
        error: `String is too long (${length} > ${$maxLength}).`
      });
    }
    if ($pattern !== undefined && !new RegExp($pattern, "u").test(instance)) {
      errors.push({
        instanceLocation,
        keyword: "pattern",
        keywordLocation: `${schemaLocation}/pattern`,
        error: `String does not match pattern.`
      });
    }
    if ($format !== undefined && format[$format] && !format[$format](instance)) {
      errors.push({
        instanceLocation,
        keyword: "format",
        keywordLocation: `${schemaLocation}/format`,
        error: `String does not match format "${$format}".`
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

// ../bun-argsbarg/node_modules/@cfworker/json-schema/dist/esm/validator.js
class Validator {
  schema;
  draft;
  shortCircuit;
  lookup;
  constructor(schema, draft = "2019-09", shortCircuit = true) {
    this.schema = schema;
    this.draft = draft;
    this.shortCircuit = shortCircuit;
    this.lookup = dereference(schema);
  }
  validate(instance) {
    return validate(instance, this.schema, this.draft, this.lookup, this.shortCircuit);
  }
  addSchema(schema, id) {
    if (id) {
      schema = { ...schema, $id: id };
    }
    dereference(schema, this.lookup);
  }
}

// ../bun-argsbarg/src/core/formats.ts
var DURATION_RE = /^\d+[hdms]?$/i;
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDurationMs(durationStr) {
  const match = durationStr.trim().match(/^(\d+)([hdms]?)$/i);
  if (!match) {
    throw new Error("Invalid duration format. Use e.g. 30s, 20m, 1h, 2d");
  }
  const amountText = match[1];
  if (!amountText) {
    throw new Error("Invalid duration format. Use e.g. 30s, 20m, 1h, 2d");
  }
  const amount = Number.parseInt(amountText, 10);
  const unit = (match[2] || "m").toLowerCase();
  if (unit === "s")
    return amount * 1000;
  if (unit === "m")
    return amount * 60 * 1000;
  if (unit === "h")
    return amount * 60 * 60 * 1000;
  if (unit === "d")
    return amount * 24 * 60 * 60 * 1000;
  return amount * 60 * 1000;
}
function validateDuration(s) {
  if (!DURATION_RE.test(s.trim())) {
    throw new Error("Invalid duration format. Use e.g. 30s, 20m, 1h, 2d");
  }
  parseDurationMs(s);
}
function parseCommaList(s) {
  return s.split(",").map((part) => part.trim()).filter(Boolean);
}
function validateCommaList(s) {
  if (parseCommaList(s).length === 0) {
    throw new Error("Comma-separated list must contain at least one value");
  }
}
function parseDate(s) {
  const trimmed = s.trim();
  if (!DATE_RE.test(trimmed)) {
    throw new Error("Invalid date. Use YYYY-MM-DD");
  }
  const [y, m, d] = trimmed.split("-").map((part) => Number.parseInt(part, 10));
  const year = y ?? 0;
  const month = m ?? 0;
  const day = d ?? 0;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    throw new Error("Invalid date. Use YYYY-MM-DD");
  }
  return trimmed;
}
function validateDate(s) {
  parseDate(s);
}
var DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function parseDateTime(s) {
  const trimmed = s.trim();
  if (!DATE_TIME_RE.test(trimmed)) {
    throw new Error("Invalid date-time. Use RFC 3339, e.g. 2026-06-22T15:00:00Z");
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    throw new Error("Invalid date-time. Use RFC 3339, e.g. 2026-06-22T15:00:00Z");
  }
  return new Date(ms).toISOString();
}
function validateDateTime(s) {
  parseDateTime(s);
}
function validatePattern(s, pattern) {
  const re = new RegExp(pattern);
  if (!re.test(s)) {
    throw new Error(`Value does not match required pattern: ${pattern}`);
  }
}
function formatValidationError(format2, value) {
  switch (format2) {
    case "duration" /* Duration */:
      return `Invalid duration: ${value} (use e.g. 30s, 20m, 1h, 2d)`;
    case "comma-list" /* CommaList */:
      return `Invalid comma-separated list: ${value}`;
    case "date" /* Date */:
      return `Invalid date: ${value} (use YYYY-MM-DD)`;
    case "date-time" /* DateTime */:
      return `Invalid date-time: ${value} (use RFC 3339, e.g. 2026-06-22T15:00:00Z)`;
  }
}
function validateFormatValue(value, format2, pattern) {
  if (format2 !== undefined) {
    switch (format2) {
      case "duration" /* Duration */:
        validateDuration(value);
        return;
      case "comma-list" /* CommaList */:
        validateCommaList(value);
        return;
      case "date" /* Date */:
        validateDate(value);
        return;
      case "date-time" /* DateTime */:
        validateDateTime(value);
        return;
    }
  }
  if (pattern !== undefined) {
    validatePattern(value, pattern);
  }
}

// ../bun-argsbarg/src/config/validate.ts
if (!format["comma-list"]) {
  format["comma-list"] = (value) => {
    try {
      validateCommaList(value);
      return true;
    } catch {
      return false;
    }
  };
}
function dataForSchemaValidation(data) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return data;
  }
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (isFrameworkConfigKey(key)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}
function schemaWithoutRequired(schema) {
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map(schemaWithoutRequired);
  }
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "required") {
      continue;
    }
    out[key] = schemaWithoutRequired(value);
  }
  return out;
}
function formatInstancePath(instanceLocation) {
  if (instanceLocation.length === 0 || instanceLocation === "#") {
    return "$";
  }
  if (instanceLocation.startsWith("#/")) {
    return instanceLocation.slice(2).replace(/\//g, ".");
  }
  return instanceLocation;
}
function formatValidationErrors(errors) {
  return errors.map(({ instanceLocation, error }) => {
    const path = formatInstancePath(instanceLocation);
    return `${path}: ${error}`;
  });
}
function decodeJsonPointerSegment2(segment) {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}
function resolveSchemaDraft(schema) {
  const $schema = schema.$schema;
  if (typeof $schema !== "string") {
    return "7";
  }
  const normalized = $schema.toLowerCase();
  if (normalized.includes("2020-12")) {
    return "2020-12";
  }
  if (normalized.includes("2019-09")) {
    return "2019-09";
  }
  if (normalized.includes("draft-04") || normalized.includes("draft/4")) {
    return "4";
  }
  if (normalized.includes("draft-07") || normalized.includes("draft/7")) {
    return "7";
  }
  return "7";
}
function resolveJsonPointer2(root, ref) {
  if (!ref.startsWith("#/")) {
    return;
  }
  const segments = ref.slice(2).split("/").filter((segment) => segment.length > 0).map(decodeJsonPointerSegment2);
  let current = root;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return;
    }
    current = current[segment];
  }
  return current;
}
function attachRootCompanionSchemas(validator, root, active) {
  if (active === root) {
    return;
  }
  const companion = {};
  if (typeof root.definitions === "object" && root.definitions !== null && !Array.isArray(root.definitions) && Object.keys(root.definitions).length > 0) {
    companion.definitions = root.definitions;
  }
  if (typeof root.$defs === "object" && root.$defs !== null && !Array.isArray(root.$defs) && Object.keys(root.$defs).length > 0) {
    companion.$defs = root.$defs;
  }
  if (Object.keys(companion).length > 0) {
    validator.addSchema(companion);
  }
}
function validatorForSchema(schema, root, partial) {
  const active = partial ? schemaWithoutRequired(schema) : schema;
  const validator = new Validator(active, resolveSchemaDraft(root), false);
  attachRootCompanionSchemas(validator, root, active);
  return validator;
}
function validateInstance(data, schema, root, partial, stripFrameworkKeys) {
  const validator = validatorForSchema(schema, root, partial);
  const payload = stripFrameworkKeys ? dataForSchemaValidation(data) : data;
  const result = validator.validate(payload);
  if (result.valid) {
    return { valid: true, errors: [] };
  }
  return { valid: false, errors: formatValidationErrors(result.errors) };
}
function validateAgainstSchema(data, rootSchema, partial) {
  return validateInstance(data, rootSchema, rootSchema, partial, true);
}
function validateConfigDocument(data, rootSchema) {
  return validateAgainstSchema(data, rootSchema, false);
}
function validateConfigDocumentPartial(data, rootSchema) {
  return validateAgainstSchema(data, rootSchema, true);
}
function resolveSchema(schema, root) {
  const ref = schema.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    return schema;
  }
  const target = resolveJsonPointer2(root, ref);
  if (typeof target === "object" && target !== null && !Array.isArray(target)) {
    return target;
  }
  return schema;
}
function normalizeTypes(type) {
  if (typeof type === "string") {
    return [type];
  }
  if (Array.isArray(type)) {
    return type.filter((t) => typeof t === "string");
  }
  return [];
}
function validateParsedConfigValue(parsed, propertySchema, rootSchema) {
  if (!propertySchema) {
    return parsed;
  }
  const result = validateInstance(parsed, propertySchema, rootSchema, false, false);
  if (!result.valid) {
    throw new Error(result.errors[0] ?? "Invalid config value");
  }
  return parsed;
}
function parseJsonLiteral(raw, propertySchema, rootSchema) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }
  return validateParsedConfigValue(parsed, propertySchema, rootSchema);
}
function homogeneousPrimitiveArrayItems(arraySchema, rootSchema) {
  const items = arraySchema.items;
  if (typeof items !== "object" || items === null || Array.isArray(items)) {
    return;
  }
  const resolved = resolveSchema(items, rootSchema);
  if (!resolved) {
    return;
  }
  const types = normalizeTypes(resolved.type);
  if (types.length !== 1) {
    return;
  }
  const kind = types[0];
  if (kind === "string" || kind === "integer" || kind === "number" || kind === "boolean") {
    const format2 = typeof resolved.format === "string" ? resolved.format : undefined;
    return { kind, format: format2 };
  }
  return;
}
function parseBooleanToken(raw) {
  const lower = raw.trim().toLowerCase();
  if (lower === "true" || lower === "1")
    return true;
  if (lower === "false" || lower === "0")
    return false;
  throw new Error("Expected boolean: true, false, 1, or 0");
}
function parsePrimitiveArraySegment(segment, items) {
  switch (items.kind) {
    case "string": {
      if (items.format === "date") {
        return parseDate(segment);
      }
      if (items.format === "date-time") {
        return parseDateTime(segment);
      }
      return segment;
    }
    case "integer": {
      const n = Number(segment);
      if (Number.isNaN(n) || !Number.isInteger(n)) {
        throw new Error(`Expected integer: ${segment}`);
      }
      return n;
    }
    case "number": {
      const n = Number(segment);
      if (Number.isNaN(n)) {
        throw new Error(`Expected number: ${segment}`);
      }
      return n;
    }
    case "boolean":
      return parseBooleanToken(segment);
  }
}
function parseHomogeneousPrimitiveArray(raw, arraySchema, rootSchema) {
  const items = homogeneousPrimitiveArrayItems(arraySchema, rootSchema);
  if (!items) {
    throw new Error("Use --json for object or array config values");
  }
  const segments = parseCommaList(raw);
  if (segments.length === 0) {
    throw new Error("Comma-separated list must contain at least one value");
  }
  return segments.map((segment) => parsePrimitiveArraySegment(segment, items));
}
function configValueInputHint(propertySchema, rootSchema) {
  if (!propertySchema) {
    return;
  }
  const resolved = resolveSchema(propertySchema, rootSchema);
  if (!resolved) {
    return;
  }
  const types = normalizeTypes(resolved.type);
  if (types.includes("array") && homogeneousPrimitiveArrayItems(resolved, rootSchema)) {
    return "comma-separated or JSON array";
  }
  if (types.includes("array") || types.includes("object")) {
    return "JSON";
  }
  return;
}
function parseConfigSetValue(raw, propertySchema, rootSchema, useJson) {
  if (useJson) {
    return parseJsonLiteral(raw, propertySchema, rootSchema);
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseJsonLiteral(trimmed, propertySchema, rootSchema);
  }
  const resolved = propertySchema ? resolveSchema(propertySchema, rootSchema) : undefined;
  const types = resolved ? normalizeTypes(resolved.type) : ["string"];
  if (types.includes("boolean")) {
    return parseBooleanToken(trimmed);
  }
  if (types.includes("number") || types.includes("integer")) {
    const n = Number(trimmed);
    if (Number.isNaN(n)) {
      throw new Error("Expected number");
    }
    if (types.includes("integer") && !Number.isInteger(n)) {
      throw new Error("Expected integer");
    }
    return n;
  }
  if (types.includes("array")) {
    if (!resolved) {
      throw new Error("Use --json for object or array config values");
    }
    const parsed = parseHomogeneousPrimitiveArray(trimmed, resolved, rootSchema);
    return validateParsedConfigValue(parsed, propertySchema, rootSchema);
  }
  if (types.includes("object")) {
    throw new Error("Use --json for object or array config values");
  }
  return raw;
}

// ../bun-argsbarg/src/config/bootstrap.ts
function bootstrapAppConfig(program, opts) {
  let fileData;
  if (opts.validateFile === true) {
    fileData = readAppConfigFile(program);
  } else if (opts.validateFile === "soft") {
    try {
      fileData = readAppConfigFile(program);
      if (opts.runtime) {
        delete opts.runtime.state.configFileError;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fileData = readAppConfigFileRaw(resolveAppConfigPath(program));
      if (opts.runtime) {
        opts.runtime.state.configFileError = message;
      }
      opts.emitter?.emit({
        level: "warn",
        message,
        action: "config.invalid"
      });
    }
  } else {
    fileData = readAppConfigFileRaw(resolveAppConfigPath(program));
  }
  const hostEnv = captureMappedHostEnv(program);
  const resolved = resolveAppConfig(program, fileData, hostEnv);
  exportConfigToEnv(program, resolved, hostEnv);
  return { fileData, resolved };
}
function readSensitiveLine() {
  const stdin = process.stdin;
  const canRaw = stdin.isTTY && typeof stdin.setRawMode === "function";
  const wasRaw = canRaw && stdin.isRaw;
  if (canRaw) {
    try {
      stdin.setRawMode(true);
    } catch {}
  }
  try {
    let result = "";
    const buf = Buffer.alloc(1);
    while (true) {
      const n = readSync2(0, buf, { length: 1 });
      if (n <= 0) {
        break;
      }
      const byte = buf[0];
      if (byte === 3) {
        process.stderr.write(`
`);
        process.exit(130);
      }
      if (byte === 4) {
        break;
      }
      if (byte === 10 || byte === 13) {
        break;
      }
      if (byte === 127 || byte === 8) {
        if (result.length > 0) {
          result = result.slice(0, -1);
          process.stderr.write("\b \b");
        }
        continue;
      }
      result += String.fromCharCode(byte);
      process.stderr.write("*");
    }
    process.stderr.write(`
`);
    return result;
  } finally {
    if (canRaw) {
      try {
        stdin.setRawMode(!!wasRaw);
      } catch {}
    }
  }
}
function readPromptLine2(mask) {
  if (mask) {
    return readSensitiveLine();
  }
  return readPromptLine();
}
function resolvedFromEnv(entry, hostEnv) {
  if (!entry.env) {
    return false;
  }
  const val = hostEnv[entry.env];
  return val !== undefined && val.length > 0;
}
function promptConfigKey(key, entry, current, configure, jsonSchemaRequired, hostEnv, jsonSchema) {
  const baseTitle = entry.title ?? defaultConfigEntryTitle(key);
  const titleWithEnv = entry.env ? `${baseTitle} (${entry.env})` : baseTitle;
  const required = configEntryRequired(key, entry, jsonSchemaRequired);
  const heading = required || !configure ? titleWithEnv : `${titleWithEnv} (optional)`;
  const propSchema = jsonSchema ? configPropertySchema(jsonSchema, key) : undefined;
  const valueHint = jsonSchema ? configValueInputHint(propSchema, jsonSchema) : undefined;
  const valueHintSuffix = valueHint ? ` (${valueHint})` : "";
  process.stderr.write(`${heading}
`);
  process.stderr.write(`  ${entry.description}
`);
  const hasCurrent = current !== undefined && current !== null && String(current).length > 0;
  const sensitive = configEntrySensitive(key, entry);
  if (hasCurrent) {
    process.stderr.write(`  Current: ${sensitive ? "REDACTED" : stringifyConfigValue(current)}
`);
    const acceptPrompt = resolvedFromEnv(entry, hostEnv) ? `  Value (Enter to use env)${valueHintSuffix}: ` : `  Value (Enter to keep)${valueHintSuffix}: `;
    process.stderr.write(acceptPrompt);
  } else {
    process.stderr.write(`  Value${valueHintSuffix}: `);
  }
  const input = readPromptLine2(sensitive);
  if (input.length === 0 && hasCurrent) {
    return { value: current, userTyped: false };
  }
  if (input.length > 0) {
    const rootSchema = jsonSchema ?? { type: "object", properties: {} };
    const parsed = parseConfigSetValue(input, propSchema, rootSchema, false);
    return { value: parsed, userTyped: true };
  }
  return { value: undefined, userTyped: false };
}
function writeConfigureSetupHeading() {
  process.stderr.write(`
Configuration Setup

`);
}
function shouldShowConfigureSetupHeading(program) {
  if (!program.appConfig)
    return false;
  return Object.keys(program.appConfig.entries).length > 0;
}
function isPresent3(value) {
  if (value === undefined || value === null)
    return false;
  if (typeof value === "string" && value.length === 0)
    return false;
  return true;
}
function bindingsDiffer(a, b) {
  return JSON.stringify(readBindings(a)) !== JSON.stringify(readBindings(b));
}
function shouldWizardPromptConfigKey(key, fileData, entry, resolved, opts) {
  const bindings = readBindings(fileData);
  if (bindings[key] === "env" && !isPresent3(resolved[key])) {
    return true;
  }
  if (opts.rePromptAll) {
    return true;
  }
  return !isKeyAddressed(key, fileData, entry);
}
function promptMissingRequired(program) {
  const appConfig = program.appConfig;
  const updates = {};
  if (!appConfig) {
    return updates;
  }
  const jsonSchema = effectiveJsonSchema(program);
  const fromSchema = jsonSchema ? jsonSchemaRequiredKeys(jsonSchema) : undefined;
  const hostEnv = captureMappedHostEnv(program);
  const path = resolveAppConfigPath(program);
  const fileData = readAppConfigFileRaw(path);
  const resolved = resolveAppConfig(program, fileData, hostEnv);
  let headingWritten = false;
  for (const [key, entry] of Object.entries(appConfig.entries)) {
    if (!configEntryRequired(key, entry, fromSchema)) {
      continue;
    }
    const bindings = readBindings(fileData);
    if (bindings[key] === "env" && !isPresent3(resolved[key])) {} else if (isKeyAddressed(key, fileData, entry) && isPresent3(resolved[key])) {
      continue;
    }
    const current = resolved[key];
    if (!headingWritten) {
      writeConfigureSetupHeading();
      headingWritten = true;
    }
    const { value, userTyped } = promptConfigKey(key, entry, current, false, fromSchema, hostEnv, jsonSchema);
    if (userTyped && value !== undefined && String(value).length > 0) {
      updates[key] = value;
      Object.assign(updates, setBinding(updates, key, "file"));
    }
  }
  return updates;
}
function runConfigure(program, opts = {}) {
  if (!program.appConfig) {
    throw new Error("configure requires program.appConfig on the program root.");
  }
  if (!process.stdin.isTTY) {
    const { resolved: resolved2 } = bootstrapAppConfig(program, { validateFile: false });
    const missing = missingRequiredConfig(program, resolved2);
    if (missing.length > 0) {
      process.stderr.write(`${formatMissingConfigMessage(program, missing)}
`);
    } else {
      process.stderr.write(`configure requires an interactive terminal.
`);
    }
    process.exit(1);
  }
  const path = resolveAppConfigPath(program);
  const existing = readAppConfigFileRaw(path);
  const hostEnv = captureMappedHostEnv(program);
  const jsonSchema = effectiveJsonSchema(program);
  const fromSchema = jsonSchema ? jsonSchemaRequiredKeys(jsonSchema) : undefined;
  const resolved = resolveAppConfig(program, existing, hostEnv);
  let next = { ...existing };
  let changed = false;
  if (opts.showHeading !== false && shouldShowConfigureSetupHeading(program)) {
    writeConfigureSetupHeading();
  }
  for (const [key, entry] of Object.entries(program.appConfig.entries)) {
    if (!shouldWizardPromptConfigKey(key, existing, entry, resolved, opts)) {
      continue;
    }
    const before = next[key];
    const bindingsBefore = readBindings(next);
    const current = resolved[key];
    const required = configEntryRequired(key, entry, fromSchema);
    const { value, userTyped } = promptConfigKey(key, entry, current, true, fromSchema, hostEnv, jsonSchema);
    if (userTyped && value !== undefined && String(value).length > 0) {
      if (JSON.stringify(value) !== JSON.stringify(before) || bindingsBefore[key] !== "file") {
        changed = true;
      }
      next = setBinding({ ...next, [key]: value }, key, "file");
      continue;
    }
    if (!userTyped && isPresent3(current) && resolvedFromEnv(entry, hostEnv)) {
      const storedInFile = key in existing && existing[key] !== undefined && existing[key] !== null && String(existing[key]).length > 0;
      if (!storedInFile) {
        const withBinding = setBinding(clearFileValue(next, key), key, "env");
        if (bindingsDiffer(next, withBinding) || key in next) {
          changed = true;
        }
        next = withBinding;
      }
      continue;
    }
    if (!userTyped && !required && !isPresent3(current) && inputWasSkipped(value, userTyped)) {
      const withBinding = setBinding(next, key, "skip");
      if (bindingsDiffer(next, withBinding)) {
        changed = true;
      }
      next = withBinding;
    }
  }
  if (changed) {
    writeAppConfigFile(program, next, { partial: true });
    const updated = resolveAppConfig(program, next, hostEnv);
    exportConfigToEnv(program, updated, hostEnv);
    return { path, changed: true };
  }
  return { path, changed: false };
}
function inputWasSkipped(value, userTyped) {
  return !userTyped && (value === undefined || String(value).length === 0);
}
function appConfigStatus(program) {
  if (!program.appConfig) {
    return;
  }
  const path = displayAppConfigPath(program);
  let fileData = {};
  try {
    fileData = readAppConfigFile(program);
  } catch {
    fileData = readAppConfigFileRaw(resolveAppConfigPath(program));
  }
  const hostEnv = captureMappedHostEnv(program);
  const resolved = resolveAppConfig(program, fileData, hostEnv);
  exportConfigToEnv(program, resolved, hostEnv);
  const jsonSchema = effectiveJsonSchema(program);
  const fromSchema = jsonSchema ? jsonSchemaRequiredKeys(jsonSchema) : undefined;
  const required = Object.entries(program.appConfig.entries).filter(([key, entry]) => configEntryRequired(key, entry, fromSchema)).map(([key]) => {
    const set = resolved[key] !== undefined && resolved[key] !== null && String(resolved[key]).length > 0;
    return {
      key,
      set,
      binding: bindingForKey(key, fileData, set)
    };
  });
  return { path, exists: appConfigFileExists(program), required };
}
function ensureAppConfig(program, opts) {
  if (!program.appConfig) {
    return;
  }
  let fileData;
  try {
    fileData = readAppConfigFile(program);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}
`);
    process.exit(1);
  }
  const hostEnv = captureMappedHostEnv(program);
  let resolved = resolveAppConfig(program, fileData, hostEnv);
  exportConfigToEnv(program, resolved, hostEnv);
  if (opts.interactive && process.stdin.isTTY) {
    if (opts.configure) {
      runConfigure(program, { context: "standalone", rePromptAll: true });
      fileData = readAppConfigFileRaw(resolveAppConfigPath(program));
      resolved = resolveAppConfig(program, fileData, hostEnv);
      exportConfigToEnv(program, resolved, hostEnv);
      return { fileData, resolved };
    }
    const updates = promptMissingRequired(program);
    if (Object.keys(updates).length > 0) {
      const merged = { ...fileData, ...updates };
      writeAppConfigFile(program, merged, { partial: true });
      fileData = merged;
      resolved = resolveAppConfig(program, fileData, hostEnv);
      exportConfigToEnv(program, resolved, hostEnv);
    }
  }
  const missing = missingRequiredConfig(program, resolved);
  if (missing.length === 0) {
    return { fileData, resolved };
  }
  if (opts.exitOnMissing) {
    process.stderr.write(`${formatMissingConfigMessage(program, missing)}
`);
    process.exit(1);
  }
  return { fileData, resolved };
}

// ../bun-argsbarg/src/utils.ts
function fullStringIsDouble(s) {
  if (s.trim().length === 0)
    return false;
  const num = Number(s);
  if (Number.isNaN(num))
    return false;
  return !Number.isNaN(parseFloat(s)) && Number.isFinite(num);
}
function strictParseDouble(s) {
  if (!fullStringIsDouble(s))
    return null;
  const num = Number(s);
  return Number.isNaN(num) ? null : num;
}
var isInteractiveTty = !!process.stdin.isTTY;

// ../bun-argsbarg/src/core/parse.ts
var helpShort = "-h";
var helpLong = "--help";
function isHelpTok(tok) {
  return tok === helpShort || tok === helpLong;
}
function findChild(cmds, name) {
  return cmds.find((c) => c.key === name);
}
function isParamRouterKey2(key) {
  return key.startsWith(":");
}
function findStaticChild(cmds, name) {
  const ch = cmds.find((c) => c.key === name);
  if (!ch || isParamRouterKey2(ch.key)) {
    return;
  }
  return ch;
}
function findParamChild(cmds) {
  return cmds.find((c) => isParamRouterKey2(c.key));
}
function findOptionByName(defs, name) {
  return defs.find((o) => o.name === name);
}
function findOptionDefByShort(defs, short) {
  return defs.find((o) => o.shortName === short);
}
function consumeOptions(defs, lenientUnknown, argv, i, opts) {
  let idx = i;
  function consumeLong(tok) {
    const body = tok.slice(2);
    let optName;
    let inlineVal;
    const eqIdx = body.indexOf("=");
    if (eqIdx !== -1) {
      optName = body.slice(0, eqIdx);
      inlineVal = body.slice(eqIdx + 1);
    } else {
      optName = body;
      inlineVal = undefined;
    }
    const def = findOptionByName(defs, optName);
    if (!def) {
      if (lenientUnknown)
        return "";
      return `Unknown option: --${optName}`;
    }
    if (inlineVal !== undefined) {
      if (def.kind === "presence" /* Presence */) {
        opts[def.name] = "1";
      } else {
        opts[def.name] = inlineVal;
      }
      idx += 1;
      return null;
    }
    if (def.kind === "presence" /* Presence */) {
      opts[def.name] = "1";
    } else {
      idx += 1;
      if (idx >= argv.length) {
        return `Missing value for option: --${optName}`;
      }
      opts[def.name] = argv[idx];
    }
    idx += 1;
    return null;
  }
  function consumeShort(tok) {
    if (tok.length < 2)
      return `Unexpected option token: ${tok}`;
    const shorts = tok.slice(1);
    let j = 0;
    while (j < shorts.length) {
      const shortChar = shorts[j];
      const def = findOptionDefByShort(defs, shortChar);
      if (!def) {
        if (lenientUnknown)
          return "";
        return `Unknown option: -${shortChar}`;
      }
      if (def.kind === "presence" /* Presence */) {
        opts[def.name] = "1";
        j += 1;
        continue;
      }
      if (j !== 0 || j + 1 < shorts.length) {
        return `Short option -${shortChar} requires a value and cannot be bundled: ${tok}`;
      }
      idx += 1;
      if (idx >= argv.length) {
        return `Missing value for option: -${shortChar}`;
      }
      opts[def.name] = argv[idx];
      idx += 1;
      return null;
    }
    idx += 1;
    return null;
  }
  while (idx < argv.length) {
    const tok = argv[idx];
    if (isHelpTok(tok))
      break;
    if (!tok.startsWith("-"))
      break;
    if (tok === "--") {
      idx += 1;
      return {
        report: { err: null, stoppedOnUnknown: false, sawDoubleDash: true },
        nextIndex: idx
      };
    }
    if (tok.startsWith("--")) {
      const err = consumeLong(tok);
      if (err === "")
        return {
          report: { err: null, stoppedOnUnknown: true, sawDoubleDash: false },
          nextIndex: idx
        };
      if (err)
        return { report: { err, stoppedOnUnknown: false, sawDoubleDash: false }, nextIndex: idx };
    } else {
      const err = consumeShort(tok);
      if (err === "")
        return {
          report: { err: null, stoppedOnUnknown: true, sawDoubleDash: false },
          nextIndex: idx
        };
      if (err)
        return { report: { err, stoppedOnUnknown: false, sawDoubleDash: false }, nextIndex: idx };
    }
  }
  return { report: { err: null, stoppedOnUnknown: false, sawDoubleDash: false }, nextIndex: idx };
}
function resolveNodeAtPath(root, path) {
  if (path.length === 0) {
    return root;
  }
  let node = root;
  for (const seg of path) {
    if (!isCliRouter(node)) {
      return;
    }
    const ch = findChild(node.commands, seg);
    if (!ch) {
      return;
    }
    node = ch;
  }
  return node;
}
function collectPathOptionDefs(root, path) {
  const defs = [...root.options ?? []];
  let node = root;
  for (const seg of path) {
    if (!isCliRouter(node)) {
      break;
    }
    const ch = findChild(node.commands, seg);
    if (!ch) {
      break;
    }
    defs.push(...ch.options ?? []);
    node = ch;
  }
  return defs;
}
function collectOptionDefs(root, path) {
  const node = resolveNodeAtPath(root, path);
  if (!node || !isCliLeaf(node)) {
    return [];
  }
  return [...node.options ?? []];
}
function finishJsonLeaf(node, startIdx, argv, path, opts, pathParams) {
  let idx = startIdx;
  const args = [];
  if (idx < argv.length) {
    const tok = argv[idx];
    if (isHelpTok(tok)) {
      return helpResult(path, true, pathParams);
    }
    if (tok === "--") {
      return errorResult("Unexpected extra arguments", path, [], pathParams);
    }
    if (tok.startsWith("-")) {
      const kindLabel = node.kind === "document" ? "Document" : "JSON";
      return errorResult(`${kindLabel} commands do not accept options: ${tok}`, path, [], pathParams);
    }
    args.push(tok);
    idx += 1;
  }
  if (idx < argv.length) {
    return errorResult("Unexpected extra arguments", path, [], pathParams);
  }
  return {
    kind: "ok" /* Ok */,
    path,
    opts,
    args,
    pathParams,
    helpExplicit: false,
    helpPath: [],
    errorMsg: "",
    errorHelpPath: []
  };
}
function finishLeaf(node, startIdx, argv, path, opts, optionDefs, forcePositionalsIn, pathParams) {
  let idx = startIdx;
  const args = [];
  let forcePositionals = forcePositionalsIn;
  function consumePendingOptions() {
    while (!forcePositionals && idx < argv.length) {
      const tok = argv[idx];
      if (tok === "--") {
        forcePositionals = true;
        idx += 1;
        break;
      }
      if (isHelpTok(tok)) {
        return helpResult(path, true, pathParams);
      }
      if (tok.startsWith("-")) {
        const rep = consumeOptions(optionDefs, false, argv, idx, opts);
        if (rep.report.err) {
          return errorResult(rep.report.err, path, [], pathParams);
        }
        if (rep.report.sawDoubleDash) {
          forcePositionals = true;
        }
        if (rep.nextIndex > idx) {
          idx = rep.nextIndex;
          continue;
        }
        return errorResult(`Unexpected option token: ${tok}`, path, [], pathParams);
      }
      break;
    }
    return null;
  }
  for (const p of node.positionals ?? []) {
    const { argMin = 1, argMax = 1 } = p;
    if (argMax === 1) {
      const pendingErr = consumePendingOptions();
      if (pendingErr)
        return pendingErr;
      if (argMin >= 1) {
        if (idx >= argv.length) {
          return errorResult(`Missing positional argument: ${p.name}`, path, [], pathParams);
        }
        args.push(argv[idx]);
        idx += 1;
      } else if (idx < argv.length) {
        args.push(argv[idx]);
        idx += 1;
      }
      continue;
    }
    let count = 0;
    if (argMax === 0) {
      while (idx < argv.length) {
        const pendingErr = consumePendingOptions();
        if (pendingErr)
          return pendingErr;
        if (idx >= argv.length)
          break;
        args.push(argv[idx]);
        idx += 1;
        count += 1;
      }
    } else {
      while (count < argMax && idx < argv.length) {
        const pendingErr = consumePendingOptions();
        if (pendingErr)
          return pendingErr;
        if (idx >= argv.length)
          break;
        args.push(argv[idx]);
        idx += 1;
        count += 1;
      }
    }
    if (count < argMin) {
      return errorResult(`Expected at least ${argMin} argument(s) for ${p.name}, got ${count}`, path, [], pathParams);
    }
  }
  const trailingErr = consumePendingOptions();
  if (trailingErr)
    return trailingErr;
  if (idx < argv.length) {
    return errorResult("Unexpected extra arguments", path, [], pathParams);
  }
  return {
    kind: "ok" /* Ok */,
    path,
    opts,
    args,
    pathParams,
    helpExplicit: false,
    helpPath: [],
    errorMsg: "",
    errorHelpPath: []
  };
}
function errorResult(errorMsg, errorHelpPath = [], path = errorHelpPath, pathParams = {}) {
  return {
    kind: "error" /* Error */,
    path,
    opts: {},
    args: [],
    pathParams,
    helpExplicit: false,
    helpPath: [],
    errorMsg,
    errorHelpPath
  };
}
function helpResult(p, explicit, pathParams = {}) {
  return {
    kind: "help" /* Help */,
    path: [],
    opts: {},
    args: [],
    pathParams,
    helpExplicit: explicit,
    helpPath: p,
    errorMsg: "",
    errorHelpPath: []
  };
}
function descendChild(parent, tok, path, pathParams, cliEnabled) {
  const staticChild = findStaticChild(parent.commands, tok);
  if (staticChild) {
    if (!isCliCallable(staticChild, cliEnabled)) {
      return { ok: false, error: errorResult(`Unknown subcommand: ${tok}`, path, [], pathParams) };
    }
    path.push(tok);
    return { ok: true, node: staticChild, cliEnabled: isCliCallable(staticChild, cliEnabled) };
  }
  const paramChild = findParamChild(parent.commands);
  if (paramChild && isCliCallable(paramChild, cliEnabled)) {
    const paramName = paramChild.key.slice(1);
    path.push(paramChild.key);
    pathParams[paramName] = tok;
    return { ok: true, node: paramChild, cliEnabled: isCliCallable(paramChild, cliEnabled) };
  }
  return { ok: false, error: errorResult(`Unknown subcommand: ${tok}`, path, [], pathParams) };
}
function parse(root, argv) {
  let i = 0;
  const path = [];
  const pathParams = {};
  const opts = {};
  let cliEnabled = true;
  const rootLenient = isCliRouter(root) && root.fallbackCommand !== undefined && ((root.fallbackMode ?? "missingOnly" /* MissingOnly */) === "missingOrUnknown" /* MissingOrUnknown */ || (root.fallbackMode ?? "missingOnly" /* MissingOnly */) === "unknownOnly" /* UnknownOnly */);
  const rootRep = consumeOptions(root.options ?? [], rootLenient, argv, i, opts);
  if (rootRep.report.err) {
    return errorResult(rootRep.report.err);
  }
  i = rootRep.nextIndex;
  let forcePositionals = rootRep.report.sawDoubleDash;
  if (i < argv.length && !forcePositionals && isHelpTok(argv[i])) {
    return helpResult([], true);
  }
  let cmdName;
  let node;
  if (isCliLeaf(root)) {
    if (isDocumentLeaf(root)) {
      return finishJsonLeaf(root, i, argv, path, opts, pathParams);
    }
    return finishLeaf(root, i, argv, path, opts, root.options ?? [], forcePositionals, pathParams);
  }
  if (i >= argv.length) {
    if (root.fallbackCommand !== undefined && ((root.fallbackMode ?? "missingOnly" /* MissingOnly */) === "missingOnly" /* MissingOnly */ || (root.fallbackMode ?? "missingOnly" /* MissingOnly */) === "missingOrUnknown" /* MissingOrUnknown */)) {
      cmdName = root.fallbackCommand;
      node = findChild(root.commands, cmdName);
      if (!node) {
        return errorResult(`Unknown command: ${cmdName}`, path, []);
      }
    } else {
      return helpResult([], false);
    }
  } else {
    const peek = argv[i];
    const childPick = !forcePositionals ? findStaticChild(root.commands, peek) : undefined;
    if (childPick !== undefined) {
      if (!isCliCallable(childPick, cliEnabled)) {
        return errorResult(`Unknown command: ${peek}`, path, [], pathParams);
      }
      cmdName = peek;
      i += 1;
      node = childPick;
      cliEnabled = isCliCallable(childPick, cliEnabled);
    } else if (!forcePositionals && isCliRouter(root)) {
      const paramChild = findParamChild(root.commands);
      if (paramChild && isCliCallable(paramChild, cliEnabled)) {
        cmdName = paramChild.key;
        pathParams[paramChild.key.slice(1)] = peek;
        i += 1;
        node = paramChild;
        cliEnabled = isCliCallable(paramChild, cliEnabled);
      } else {
        const fallbackCommand = root.fallbackCommand;
        const canRouteUnknown = fallbackCommand !== undefined && ((root.fallbackMode ?? "missingOnly" /* MissingOnly */) === "missingOrUnknown" /* MissingOrUnknown */ || (root.fallbackMode ?? "missingOnly" /* MissingOnly */) === "unknownOnly" /* UnknownOnly */);
        if (canRouteUnknown) {
          cmdName = fallbackCommand;
          node = findChild(root.commands, cmdName);
          if (!node) {
            return errorResult(`Unknown command: ${cmdName}`, path, [], pathParams);
          }
        } else {
          return errorResult(`Unknown command: ${peek}`, path, [], pathParams);
        }
      }
    } else {
      const fallbackCommand = root.fallbackCommand;
      const canRouteUnknown = fallbackCommand !== undefined && ((root.fallbackMode ?? "missingOnly" /* MissingOnly */) === "missingOrUnknown" /* MissingOrUnknown */ || (root.fallbackMode ?? "missingOnly" /* MissingOnly */) === "unknownOnly" /* UnknownOnly */);
      if (canRouteUnknown) {
        cmdName = fallbackCommand;
        node = findChild(root.commands, cmdName);
        if (!node) {
          return errorResult(`Unknown command: ${cmdName}`, path, []);
        }
      } else {
        cmdName = peek;
        if (!forcePositionals)
          i += 1;
        node = findChild(root.commands, cmdName);
        if (!node) {
          return errorResult(forcePositionals ? `Expected subcommand but got positional: ${cmdName}` : `Unknown command: ${cmdName}`, path, []);
        }
      }
    }
  }
  path.push(cmdName);
  if (!node) {
    return errorResult(`Unknown command: ${cmdName}`, path);
  }
  let current = node;
  while (true) {
    if (isCliLeaf(current) && isDocumentLeaf(current)) {
      return finishJsonLeaf(current, i, argv, path, opts, pathParams);
    }
    if (!forcePositionals) {
      const orep = consumeOptions(current.options ?? [], false, argv, i, opts);
      if (orep.report.err) {
        return errorResult(orep.report.err, path);
      }
      i = orep.nextIndex;
      if (orep.report.sawDoubleDash) {
        forcePositionals = true;
      }
    }
    if (i < argv.length && !forcePositionals && isHelpTok(argv[i])) {
      return helpResult(path, true, pathParams);
    }
    if (i >= argv.length) {
      if (isCliRouter(current) && current.commands.length > 0) {
        const fb = current.fallbackCommand;
        const fm = current.fallbackMode ?? "missingOnly" /* MissingOnly */;
        if (fb !== undefined && (fm === "missingOnly" /* MissingOnly */ || fm === "missingOrUnknown" /* MissingOrUnknown */)) {
          const fbNode = findChild(current.commands, fb);
          if (fbNode) {
            path.push(fb);
            current = fbNode;
            cliEnabled = isCliCallable(fbNode, cliEnabled);
            continue;
          }
        }
        return helpResult(path, false, pathParams);
      }
      if (!isCliLeaf(current)) {
        return helpResult(path, false, pathParams);
      }
      return finishLeaf(current, i, argv, path, opts, current.options ?? [], forcePositionals, pathParams);
    }
    const tok = argv[i];
    if (!forcePositionals && tok.startsWith("-")) {
      return errorResult(`Unexpected option token: ${tok}`, path, [], pathParams);
    }
    if (!forcePositionals && isCliRouter(current)) {
      const descended = descendChild(current, tok, path, pathParams, cliEnabled);
      if (descended.ok) {
        i += 1;
        current = descended.node;
        cliEnabled = descended.cliEnabled;
        continue;
      }
    }
    if (isCliRouter(current) && current.commands.length > 0) {
      const fb = current.fallbackCommand;
      const fm = current.fallbackMode ?? "missingOnly" /* MissingOnly */;
      const canRouteUnknown = fb !== undefined && (fm === "missingOrUnknown" /* MissingOrUnknown */ || fm === "unknownOnly" /* UnknownOnly */);
      if (canRouteUnknown && fb !== undefined) {
        const fbNode = findChild(current.commands, fb);
        if (fbNode) {
          path.push(fb);
          current = fbNode;
          cliEnabled = isCliCallable(fbNode, cliEnabled);
          continue;
        }
      }
      return errorResult(forcePositionals ? `Expected subcommand but got positional: ${tok}` : `Unknown subcommand: ${tok}`, path, [], pathParams);
    }
    if (!isCliLeaf(current)) {
      return helpResult(path, false, pathParams);
    }
    return finishLeaf(current, i, argv, path, opts, current.options ?? [], forcePositionals, pathParams);
  }
}
function postParseValidate(root, pr) {
  if (pr.kind !== "ok" /* Ok */)
    return pr;
  const defs = collectPathOptionDefs(root, pr.path);
  const opts = { ...pr.opts };
  for (const d of defs) {
    if (d.default !== undefined && !(d.name in opts)) {
      opts[d.name] = d.default;
    }
  }
  for (const d of defs) {
    if (d.required && !(d.name in opts)) {
      if (d.kind === "json" /* Json */) {
        continue;
      }
      return errorResult(`Missing required option: --${d.name}`, pr.path);
    }
  }
  for (const [k, v] of Object.entries(opts)) {
    const d = findOptionByName(defs, k);
    if (!d) {
      return errorResult(`Unknown option key: ${k}`, pr.path);
    }
    if (d.kind === "json" /* Json */) {
      try {
        JSON.parse(v);
      } catch {
        return errorResult(`Invalid JSON for option --${k}`, pr.path);
      }
      continue;
    }
    if (d.kind === "number" /* Number */) {
      if (!fullStringIsDouble(v)) {
        return errorResult(`Invalid number for option --${k}: ${v}`, pr.path);
      }
    }
    if (d.kind === "enum" /* Enum */) {
      const choices = d.choices ?? [];
      if (!choices.includes(v)) {
        return errorResult(`Option --${k}: '${v}' is not one of: ${choices.join(", ")}`, pr.path);
      }
    }
    if (d.kind === "string" /* String */ && (d.format !== undefined || d.pattern !== undefined)) {
      try {
        validateFormatValue(v, d.format, d.pattern);
      } catch (err) {
        const msg = d.format !== undefined ? formatValidationError(d.format, v) : err instanceof Error ? err.message : String(err);
        return errorResult(`Invalid value for option --${k}: ${msg}`, pr.path);
      }
    }
  }
  return { ...pr, opts };
}

// ../bun-argsbarg/src/core/leaf-inputs.ts
class LeafInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "LeafInputError";
  }
}
var DOCUMENT_LEAF_BODY_KEY = "__documentLeafBody";
var JSON_LEAF_BODY_KEY = DOCUMENT_LEAF_BODY_KEY;
function resolveLeaf(program, commandPath2) {
  let node = program;
  for (const seg of commandPath2) {
    if (!isCliRouter(node))
      return;
    const child = node.commands.find((c) => c.key === seg);
    if (!child)
      return;
    node = child;
  }
  return isCliLeaf(node) ? node : undefined;
}
function leafNode(ctx) {
  return resolveLeaf(ctx.program, ctx.commandPath);
}
function parseJsonText(raw, label) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new LeafInputError(`${label}: JSON value is empty`);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new LeafInputError(`${label}: invalid JSON`);
  }
}
function parseDocumentText(raw, label) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new LeafInputError(`${label}: value is empty`);
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  try {
    return Bun.YAML.parse(trimmed);
  } catch {
    throw new LeafInputError(`${label}: invalid JSON or YAML`);
  }
}
async function readPipedJsonStdin() {
  const raw = await new Response(Bun.stdin).text();
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new LeafInputError("stdin is empty; pass JSON via the option flag or pipe a JSON document to stdin");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new LeafInputError("stdin is not valid JSON");
  }
}
function jsonLeafBodyHelp(kind = "json") {
  if (kind === "document") {
    return "Missing document input: pass a JSON or YAML document as an argument or pipe to stdin";
  }
  return "Missing JSON input: pass a JSON document as an argument or pipe to stdin";
}
async function readPipedJsonStdinForJsonLeaf(kind = "json") {
  const raw = await new Response(Bun.stdin).text();
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new LeafInputError(jsonLeafBodyHelp(kind));
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  try {
    return Bun.YAML.parse(trimmed);
  } catch {
    throw new LeafInputError("stdin is not valid JSON or YAML");
  }
}
function pipableJsonHelp(opt) {
  return `Missing required option --${opt.name}: pass JSON via --${opt.name} '<json>' or pipe a JSON document to stdin`;
}
function omitUndefinedInputs(out) {
  const stripped = {};
  for (const [key, value] of Object.entries(out)) {
    if (value !== undefined) {
      stripped[key] = value;
    }
  }
  return stripped;
}
function validateAgainstInputSchema(out, inputSchema) {
  const result = validateConfigDocument(omitUndefinedInputs(out), inputSchema);
  if (!result.valid) {
    throw new LeafInputError(result.errors.join("; "));
  }
}
function readJsonOptionValue(ctx, name) {
  const flagValue = ctx.stringOpt(name);
  if (flagValue !== undefined) {
    return parseJsonText(flagValue, `--${name}`);
  }
  if (name in ctx.preloadedJson) {
    return ctx.preloadedJson[name];
  }
  if (ctx.toolArgs !== undefined && name in ctx.toolArgs) {
    return ctx.toolArgs[name];
  }
  return;
}
async function preloadPipableJson(program, commandPath2, opts, invocation, args = []) {
  if (invocation !== "cli" || isInteractiveTty) {
    return {};
  }
  const leaf = resolveLeaf(program, commandPath2);
  if (leaf && isDocumentLeaf(leaf) && args.length === 0) {
    return { [JSON_LEAF_BODY_KEY]: await readPipedJsonStdinForJsonLeaf(leaf.kind) };
  }
  for (const opt of collectOptionDefs(program, commandPath2)) {
    if (opt.kind === "json" /* Json */ && opt.pipable && !(opt.name in opts)) {
      return { [opt.name]: await readPipedJsonStdin() };
    }
  }
  return {};
}
function readSyncOptionValue(ctx, opt) {
  if (opt.kind === "presence" /* Presence */) {
    return ctx.hasFlag(opt.name);
  }
  if (opt.kind === "number" /* Number */) {
    const n = ctx.numberOpt(opt.name);
    return n === null ? undefined : n;
  }
  if (opt.kind === "json" /* Json */) {
    return readJsonOptionValue(ctx, opt.name);
  }
  if (opt.format !== undefined) {
    if (opt.format === "duration" /* Duration */) {
      return ctx.durationOpt(opt.name);
    }
    if (opt.format === "comma-list" /* CommaList */) {
      return ctx.commaListOpt(opt.name);
    }
    if (opt.format === "date" /* Date */) {
      return ctx.dateOpt(opt.name);
    }
    if (opt.format === "date-time" /* DateTime */) {
      return ctx.dateTimeOpt(opt.name);
    }
  }
  return ctx.stringOpt(opt.name);
}
function loadLeafInputs(ctx) {
  const leaf = leafNode(ctx);
  if (!leaf)
    return {};
  if (isDocumentLeaf(leaf)) {
    let body;
    if (ctx.toolArgs !== undefined) {
      body = ctx.toolArgs;
    } else if (ctx.args.length > 0) {
      const [arg0] = ctx.args;
      if (arg0 === undefined) {
        throw new LeafInputError(jsonLeafBodyHelp(leaf.kind));
      }
      const label = leaf.kind === "document" ? "Document argument" : "JSON argument";
      body = parseDocumentText(arg0, label);
    } else if (JSON_LEAF_BODY_KEY in ctx.preloadedJson) {
      body = ctx.preloadedJson[JSON_LEAF_BODY_KEY];
    } else {
      throw new LeafInputError(jsonLeafBodyHelp(leaf.kind));
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      if (leaf.kind === "document") {
        throw new LeafInputError("Document input must be a JSON or YAML object");
      }
      throw new LeafInputError("JSON input must be a JSON object");
    }
    const out2 = body;
    if (leaf.inputSchema !== undefined) {
      validateAgainstInputSchema(out2, leaf.inputSchema);
    }
    return omitUndefinedInputs(out2);
  }
  const out = {};
  const options = collectOptionDefs(ctx.program, ctx.commandPath);
  for (const opt of options) {
    out[opt.name] = readSyncOptionValue(ctx, opt);
  }
  for (const p of leaf.positionals ?? []) {
    const val = ctx.positional(p.name);
    if (val === undefined) {
      out[p.name] = undefined;
    } else if (Array.isArray(val)) {
      out[p.name] = val;
    } else {
      out[p.name] = val;
    }
  }
  for (const [name, value] of Object.entries(ctx.pathParams)) {
    if (out[name] === undefined) {
      out[name] = value;
    }
  }
  if (ctx.toolArgs !== undefined) {
    for (const [key, value] of Object.entries(ctx.toolArgs)) {
      if (out[key] === undefined) {
        out[key] = value;
      }
    }
  }
  for (const opt of options) {
    if (opt.required && out[opt.name] === undefined) {
      if (opt.kind === "json" /* Json */ && opt.pipable && ctx.invocation === "cli" && isInteractiveTty) {
        throw new LeafInputError(pipableJsonHelp(opt));
      }
      throw new LeafInputError(`Missing required option: --${opt.name}`);
    }
  }
  if (leaf.inputSchema !== undefined) {
    validateAgainstInputSchema(out, leaf.inputSchema);
  }
  return omitUndefinedInputs(out);
}

// ../bun-argsbarg/src/http/result.ts
function stripAnsi(text) {
  const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  return text.replace(ansiEscape, "");
}
function firstErrorLine(text) {
  const line = stripAnsi(text).split(`
`).map((part) => part.trim()).find((part) => part.length > 0);
  return line ?? stripAnsi(text).trim();
}
var API_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
  "access-control-max-age": "86400"
};
function apiOptionsResponse() {
  return new Response(null, { status: 204, headers: { ...API_CORS_HEADERS } });
}
function resolveRespondContentType(response, leafApiResponse) {
  return response.contentType ?? leafApiResponse?.contentType ?? (typeof response.body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8");
}
function apiSuccessResponse(response, leafApiResponse, defaultStatus) {
  const contentType = resolveRespondContentType(response, leafApiResponse);
  const headers = {
    ...API_CORS_HEADERS,
    "content-type": contentType,
    ...response.headers ?? {}
  };
  if (leafApiResponse?.contentDisposition && !headers["content-disposition"]) {
    headers["content-disposition"] = leafApiResponse.contentDisposition;
  }
  const status = response.status ?? defaultStatus ?? 200;
  const { body } = response;
  if (status === 204) {
    return new Response(null, { status: 204, headers });
  }
  if (body instanceof Uint8Array) {
    return new Response(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength), {
      status,
      headers
    });
  }
  if (typeof body === "string") {
    return new Response(body, { status, headers });
  }
  return new Response(JSON.stringify(body), { status, headers });
}
function apiErrorResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...API_CORS_HEADERS,
      "content-type": "application/json; charset=utf-8"
    }
  });
}
function apiDocsHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API Reference</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    SwaggerUIBundle({
      url: "/openapi.json",
      dom_id: "#swagger-ui",
    });
  </script>
</body>
</html>`;
}

// ../bun-argsbarg/src/log/emitter.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ../bun-argsbarg/src/log/ecs.ts
var ECS_VERSION = "8.11.0";
var PROTECTED_ECS_KEYS = new Set([
  "@timestamp",
  "log.level",
  "message",
  "ecs.version",
  "service.name",
  "service.version"
]);
function errorFields(error) {
  if (error instanceof Error) {
    return {
      "error.message": error.message,
      "error.type": error.name,
      ...error.stack ? { "error.stack_trace": error.stack } : {}
    };
  }
  return { "error.message": String(error) };
}
function buildEnrichContext(service, event) {
  return {
    level: event.level,
    message: event.message,
    action: event.action,
    requestId: event.requestId,
    traceId: event.traceId,
    spanId: event.spanId,
    labels: event.labels,
    error: event.error,
    service,
    http: event.http
  };
}
function mergeEnrichFields(line, enrich) {
  if (!enrich) {
    return;
  }
  for (const [key, value] of Object.entries(enrich)) {
    if (PROTECTED_ECS_KEYS.has(key) || key in line) {
      continue;
    }
    line[key] = value;
  }
}
function formatEcsLine(serviceOrOpts, event) {
  const opts = event !== undefined ? { service: serviceOrOpts, event } : serviceOrOpts;
  const { service, event: ev } = opts;
  const line = {
    "@timestamp": new Date().toISOString(),
    "log.level": ev.level,
    message: ev.message,
    "ecs.version": ECS_VERSION,
    "service.name": service.name,
    "service.version": service.version
  };
  if (ev.action) {
    line["event.action"] = ev.action;
  }
  if (ev.traceId) {
    line["trace.id"] = ev.traceId;
  }
  if (ev.spanId) {
    line["span.id"] = ev.spanId;
  }
  if (ev.labels && Object.keys(ev.labels).length > 0) {
    line.labels = { ...ev.labels };
  }
  if (ev.fields) {
    Object.assign(line, ev.fields);
  }
  if (ev.error !== undefined) {
    Object.assign(line, errorFields(ev.error));
  }
  mergeEnrichFields(line, opts.enrich?.(buildEnrichContext(service, ev)));
  return JSON.stringify(line);
}
function durationMsToEcsNanos(durationMs) {
  return durationMs * 1e6;
}

// ../bun-argsbarg/src/log/emitter.ts
var OBSCURE_CLIENT_MESSAGE = "An unexpected error occurred.";
function obscureUnexpectedClientMessage() {
  return OBSCURE_CLIENT_MESSAGE;
}
class LogEmitter {
  service;
  resolved;
  constructor(opts) {
    this.service = { name: opts.program.key, version: opts.program.version };
    this.resolved = opts.resolved;
  }
  get config() {
    return this.resolved;
  }
  emit(event) {
    const line = this.formatLine(event);
    process.stderr.write(`${line}
`);
    this.appendFile(line);
  }
  emitLifecycle(message, action, labels) {
    if (this.resolved.format === "text") {
      process.stderr.write(`${message}
`);
      this.appendFile(message);
      return;
    }
    this.emit({ level: "info", message, action, labels });
  }
  emitAccess(fields) {
    if (!this.resolved.access) {
      return;
    }
    if (this.resolved.format === "text") {
      const rid = fields.requestId ? ` ${fields.requestId}` : "";
      const line = `${fields.method} ${fields.path} ${fields.status} ${fields.durationMs}ms${rid}`;
      process.stderr.write(`${line}
`);
      this.appendFile(line);
      return;
    }
    const isHttp = fields.method !== "MCP";
    const action = isHttp ? "http.access" : "mcp.access";
    const httpFields = isHttp ? {
      "http.request.method": fields.method,
      "url.path": fields.path,
      "http.response.status_code": fields.status,
      "event.duration": durationMsToEcsNanos(fields.durationMs)
    } : {
      "event.duration": durationMsToEcsNanos(fields.durationMs)
    };
    if (fields.clientIp && fields.clientIp !== "unknown") {
      httpFields["client.ip"] = fields.clientIp;
    }
    this.emit({
      level: "info",
      message: `${fields.method} ${fields.path}`,
      action,
      requestId: fields.requestId,
      traceId: fields.traceId,
      spanId: fields.spanId,
      fields: httpFields,
      labels: {
        ...fields.requestId ? { request_id: fields.requestId } : {},
        ...isHttp ? {} : { rpc_method: fields.path }
      },
      http: {
        method: fields.method,
        path: fields.path,
        status: fields.status,
        durationMs: fields.durationMs,
        clientIp: fields.clientIp
      }
    });
  }
  emitInvokeError(failureKind, error, clientMessage, meta) {
    if (!this.resolved.errors) {
      return;
    }
    this.emit({
      level: failureKind === "unexpected" ? "error" : "warn",
      message: clientMessage,
      action: "invoke.error",
      labels: { failure_kind: failureKind, ...meta?.labels },
      requestId: meta?.requestId,
      traceId: meta?.traceId,
      spanId: meta?.spanId,
      error
    });
    if (this.resolved.dev && error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}
`);
      this.appendFile(error.stack);
    }
  }
  formatLine(event) {
    if (this.resolved.format === "text") {
      return this.formatTextLine(event);
    }
    const enrichCtx = this.buildEnrichContext(event);
    if (this.resolved.serialize) {
      return this.resolved.serialize(enrichCtx);
    }
    return formatEcsLine({
      service: this.service,
      event,
      enrich: this.resolved.enrich
    });
  }
  buildEnrichContext(event) {
    return {
      level: event.level,
      message: event.message,
      action: event.action,
      requestId: event.requestId,
      traceId: event.traceId,
      spanId: event.spanId,
      labels: event.labels,
      error: event.error,
      service: this.service,
      http: event.http
    };
  }
  formatTextLine(event) {
    const level = event.level.toUpperCase();
    const action = event.action ? ` [${event.action}]` : "";
    let line = `${level}${action}: ${event.message}`;
    if (event.error instanceof Error && event.error.stack) {
      line = `${line}
${event.error.stack}`;
    }
    return line;
  }
  appendFile(line) {
    const file = this.resolved.file;
    if (!file) {
      return;
    }
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${line}
`, "utf8");
    } catch {}
  }
}

// ../bun-argsbarg/src/hooks/run.ts
async function runHook(hook, label) {
  if (!hook) {
    return;
  }
  try {
    return await Promise.resolve(hook());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} hook failed: ${message}`, { cause: err });
  }
}
function classifyFailureKind(err, opts) {
  if (opts.help) {
    return "help";
  }
  if (opts.missingConfig) {
    return "missing_config";
  }
  if (opts.notReady) {
    return "not_ready";
  }
  if (opts.parseError || err instanceof LeafInputError) {
    return "validation";
  }
  if (err instanceof Error) {
    return "validation";
  }
  return "unexpected";
}
function failureKindHttpStatus(kind) {
  switch (kind) {
    case "validation":
    case "help":
      return 400;
    case "unknown_route":
      return 404;
    case "missing_config":
    case "not_ready":
      return 503;
    case "unexpected":
      return 500;
  }
}
function buildInvokeHookContext(ctx, extras) {
  return {
    invocation: ctx.invocation,
    path: extras.path,
    pathParams: { ...ctx.pathParams },
    opts: ctx.opts,
    locals: ctx.locals,
    runtime: extras.runtime,
    appConfig: ctx.appConfig,
    http: extras.http,
    mcp: extras.mcp
  };
}
function defaultClientError(err, _failureKind) {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : firstErrorLine(String(err)) || "Error";
  return { message, exitCode: 1 };
}
async function runErrorPipeline(hookCtx, err, failureKind, hooks, emitter, obscureUnexpected) {
  let clientError = defaultClientError(err, failureKind);
  if (failureKind === "unexpected" && obscureUnexpected) {
    clientError = { message: obscureUnexpectedClientMessage(), exitCode: 1 };
  }
  const errorCtx = {
    ...hookCtx,
    failureKind,
    error: err,
    clientError: { ...clientError }
  };
  const formatted = await runHook(() => hooks?.formatError?.(errorCtx), "formatError");
  if (formatted) {
    clientError = { ...clientError, ...formatted };
    errorCtx.clientError = { ...clientError };
  }
  await runHook(() => hooks?.onError?.(errorCtx), "onError");
  const displayMessage = failureKind === "unexpected" && obscureUnexpected ? obscureUnexpectedClientMessage() : clientError.message;
  emitter?.emitInvokeError(failureKind, err, displayMessage, {
    labels: {
      invocation: hookCtx.invocation,
      path: hookCtx.path.join(" ")
    },
    requestId: hookCtx.locals.requestId,
    traceId: hookCtx.http?.traceId,
    spanId: hookCtx.http?.spanId
  });
  return { failureKind, clientError, errorMsg: displayMessage };
}

// ../bun-argsbarg/src/core/respond.ts
function normalizeRespondOptions(opts) {
  if (opts.contentType !== undefined) {
    return opts;
  }
  const body = opts.body;
  if (body instanceof Uint8Array) {
    throw new Error("ctx.respond() with Uint8Array body requires an explicit contentType");
  }
  if (typeof body === "string") {
    return { ...opts, contentType: "text/plain; charset=utf-8" };
  }
  return { ...opts, contentType: "application/json; charset=utf-8" };
}
function writeRespondBodyToStdout(body) {
  if (body instanceof Uint8Array) {
    process.stdout.write(body);
    return;
  }
  if (typeof body === "string") {
    process.stdout.write(body);
    if (!body.endsWith(`
`)) {
      process.stdout.write(`
`);
    }
    return;
  }
  process.stdout.write(`${JSON.stringify(body, null, 2)}
`);
}
function encodeRespondBodyBase64(body) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(body).toString("base64");
  }
  let binary = "";
  for (const byte of body) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// ../bun-argsbarg/src/mcp/result.ts
function buildToolCallSuccessFromResponse(response) {
  const { body, contentType = "application/json; charset=utf-8" } = response;
  let structuredContent;
  let text = "";
  if (body instanceof Uint8Array) {
    structuredContent = {
      data: encodeRespondBodyBase64(body),
      contentType,
      encoding: "base64"
    };
    text = `[Binary data: ${contentType}, ${body.length} bytes]`;
  } else if (typeof body === "string") {
    structuredContent = {
      content: body,
      contentType
    };
    text = body;
  } else {
    structuredContent = body;
    text = typeof body === "object" && body !== null ? JSON.stringify(body, null, 2) : String(body ?? "");
  }
  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError: false
  };
}

// ../bun-argsbarg/src/headless/tool-call.ts
function lookupHeadlessTool(program, toolName) {
  const tools = collectMcpTools(program);
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) {
    return { ok: false, kind: "unknown", message: `Unknown tool: ${toolName}` };
  }
  const { resolved } = bootstrapAppConfig(program, { validateFile: false });
  const missingConfig = missingRequiredConfig(program, resolved);
  if (missingConfig.length > 0) {
    return {
      ok: false,
      kind: "missing_config",
      message: formatMcpMissingConfigMessage(program, missingConfig)
    };
  }
  return { ok: true, tool };
}
function invokeFailure(result) {
  const message = result.errorMsg ?? (result.stderr.trim() || `Exit code ${result.exitCode}`);
  return {
    ok: false,
    kind: result.kind === "help" ? "help" : "invoke",
    message,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    failureKind: result.failureKind,
    invokeResult: result
  };
}
function noResponseFailure(result) {
  return {
    ok: false,
    kind: "invoke",
    message: "Handler did not call ctx.respond() or return a value",
    exitCode: 1,
    stdout: result.stdout,
    stderr: result.stderr,
    failureKind: "unexpected",
    invokeResult: result
  };
}
async function executeHeadlessToolCall(cli, tool, args, invocation, mcp) {
  const argvResult = mcpToolCallToArgv(cli.program, tool, args);
  if ("error" in argvResult) {
    return {
      ok: false,
      kind: "argv",
      message: argvResult.error,
      exitCode: 1,
      stdout: "",
      stderr: "",
      failureKind: "validation"
    };
  }
  const invokeResult = await cli.invoke(argvResult, { invocation, toolArgs: args, mcp });
  if (invokeResult.kind === "help") {
    return invokeFailure(invokeResult);
  }
  if (invokeResult.kind === "ok" && invokeResult.exitCode === 0 && invokeResult.response) {
    const mcpResult = buildToolCallSuccessFromResponse(invokeResult.response);
    return {
      ok: true,
      response: invokeResult.response,
      mcpResult
    };
  }
  if (invokeResult.kind === "ok" && invokeResult.exitCode === 0) {
    return noResponseFailure(invokeResult);
  }
  return invokeFailure(invokeResult);
}
async function executeHttpRouteCall(cli, route, pathParams, query, body, http) {
  const argvResult = httpRequestToArgv(cli.program, route, pathParams, query, body);
  if ("error" in argvResult) {
    return {
      ok: false,
      kind: "argv",
      message: argvResult.error,
      exitCode: 1,
      stdout: "",
      stderr: "",
      failureKind: "validation"
    };
  }
  const toolArgs = { ...body, ...query, ...pathParams };
  const invokeResult = await cli.invoke(argvResult, { invocation: "http", toolArgs, http });
  if (invokeResult.kind === "help") {
    return invokeFailure(invokeResult);
  }
  if (invokeResult.kind === "ok" && invokeResult.exitCode === 0 && invokeResult.response) {
    const mcpResult = buildToolCallSuccessFromResponse(invokeResult.response);
    return {
      ok: true,
      response: invokeResult.response,
      mcpResult
    };
  }
  if (invokeResult.kind === "ok" && invokeResult.exitCode === 0) {
    return noResponseFailure(invokeResult);
  }
  return invokeFailure(invokeResult);
}
function headlessSuccessToHttpResponse(result, leafApiResponse, defaultStatus) {
  return apiSuccessResponse(result.response, leafApiResponse, defaultStatus);
}
function headlessFailureToHttpResponse(result, obscureUnexpected = false) {
  const status = resolveHttpErrorStatus(result);
  return apiErrorResponse(status, { error: formatHeadlessError(result, obscureUnexpected) });
}
function resolveHttpErrorStatus(result) {
  if (result.failureKind) {
    return failureKindHttpStatus(result.failureKind);
  }
  if (result.kind === "argv" || result.kind === "help") {
    return 400;
  }
  if (result.kind === "invoke" && result.message.includes("ctx.respond()")) {
    return 500;
  }
  if (result.exitCode === 1) {
    return 400;
  }
  return 500;
}
function headlessFailureMcpMessage(result, obscureUnexpected = false) {
  return formatHeadlessError(result, obscureUnexpected);
}
function formatHeadlessError(result, obscureUnexpected) {
  if (obscureUnexpected && result.failureKind === "unexpected") {
    return obscureUnexpectedClientMessage();
  }
  return stripAnsi(result.message).trim();
}

// ../bun-argsbarg/src/log/trace.ts
import { randomBytes } from "node:crypto";
var TRACEPARENT_RE = /^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/i;
function randomSpanId() {
  return randomBytes(8).toString("hex");
}
function parseTraceparent(header) {
  const match = header.trim().match(TRACEPARENT_RE);
  if (!match) {
    return;
  }
  const [, traceId, spanId, flags] = match;
  if (!traceId || !spanId || !flags) {
    return;
  }
  const flagByte = Number.parseInt(flags, 16);
  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    sampled: (flagByte & 1) === 1
  };
}
function extractTraceContext(request) {
  const parsed = parseTraceparent(request.headers.get("traceparent") ?? "");
  if (!parsed) {
    return;
  }
  return {
    traceId: parsed.traceId,
    parentSpanId: parsed.spanId,
    spanId: randomSpanId(),
    sampled: parsed.sampled
  };
}
function formatTraceparent(ctx) {
  const flags = ctx.sampled === false ? "00" : "01";
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

// ../bun-argsbarg/src/http/readiness.ts
var READINESS_CACHE_MS = 3000;
function configFileCheck(runtime) {
  const err = runtime.state.configFileError;
  if (typeof err === "string" && err.length > 0) {
    return { ok: false, error: err };
  }
  return { ok: true };
}
function configRequiredCheck(program, appConfig) {
  if (!program.appConfig) {
    return { ok: true };
  }
  const missing = missingRequiredConfig(program, appConfig.read());
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true };
}
async function customReadinessCheck(ctx) {
  const fn = ctx.program.readiness;
  if (!fn) {
    return { ok: true };
  }
  try {
    const ok = await Promise.resolve(fn(ctx));
    return ok ? { ok: true } : { ok: false, error: "readiness check returned false" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
async function evaluateReadiness(program, surface, runtime, appConfig) {
  const cached = runtime.state.readinessCache;
  if (cached && Date.now() - cached.at < READINESS_CACHE_MS) {
    return cached.result;
  }
  const ctx = { program, surface, appConfig, runtime };
  const checks = {
    config_file: configFileCheck(runtime),
    config_required: configRequiredCheck(program, appConfig),
    custom: await customReadinessCheck(ctx)
  };
  const ok = Object.values(checks).every((c) => c.ok);
  const result = { ok, checks };
  runtime.state.readinessCache = { at: Date.now(), result };
  runtime.state.readiness = result;
  return result;
}

// ../bun-argsbarg/src/http/server.ts
var DEFAULT_HOST = "127.0.0.1";
var DEFAULT_PORT = 3000;
function resolveHttpListenAddress(program) {
  const config = program.httpServer;
  return {
    hostname: config?.host ?? DEFAULT_HOST,
    port: config?.port ?? DEFAULT_PORT
  };
}
function resolveClientIp(request, trustProxy) {
  if (trustProxy) {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) {
      return xff.split(",")[0]?.trim() ?? "unknown";
    }
  }
  return "unknown";
}
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...API_CORS_HEADERS,
      "content-type": "application/json; charset=utf-8"
    }
  });
}
function parseQuery(url) {
  const out = {};
  for (const [k, v] of url.searchParams.entries()) {
    out[k] = v;
  }
  return out;
}
async function handleApiRequest(cli, request, resolved) {
  const httpConfig = resolved ?? cli.server?.http;
  const trustProxy = httpConfig?.trustProxy ?? cli.program.httpServer?.trustProxy ?? false;
  const requestId = randomUUID();
  const url = new URL(request.url);
  const clientIp = resolveClientIp(request, trustProxy);
  const trace = extractTraceContext(request);
  const wireCtx = {
    request,
    requestId,
    clientIp,
    path: url.pathname,
    method: request.method,
    ...trace ? { traceId: trace.traceId, spanId: trace.spanId } : {}
  };
  const hooks = cli.server?.httpHooks ?? cli.program.httpServer?.hooks;
  const emitter = cli.server?.emitter;
  const started = performance.now();
  const finish = async (response, failureKind, error) => {
    const durationMs = Math.round(performance.now() - started);
    if (failureKind && error !== undefined) {
      await hooks?.onError?.({
        ...wireCtx,
        failureKind,
        error
      });
    } else {
      await hooks?.onResponse?.({ ...wireCtx, status: response.status, durationMs });
    }
    emitter?.emitAccess({
      method: request.method,
      path: url.pathname,
      status: response.status,
      durationMs,
      requestId,
      clientIp,
      traceId: trace?.traceId,
      spanId: trace?.spanId
    });
    if (!trace) {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.set("traceparent", formatTraceparent({ traceId: trace.traceId, spanId: trace.spanId, sampled: trace.sampled }));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  };
  await hooks?.onRequest?.(wireCtx);
  if (request.method === "OPTIONS") {
    return finish(apiOptionsResponse());
  }
  const root = cli.program;
  const path = url.pathname;
  if (request.method === "GET" && path === "/health/liveness") {
    return finish(jsonResponse(200, { ok: true }));
  }
  if (request.method === "GET" && path === "/health/readiness") {
    const runtime = cli.server?.runtime;
    if (!runtime) {
      return finish(jsonResponse(200, { ok: true }));
    }
    const readiness = await evaluateReadiness(root, "http", runtime, cli.appConfig);
    return finish(jsonResponse(readiness.ok ? 200 : 503, readiness));
  }
  if (request.method === "GET" && path === "/openapi.json") {
    return finish(jsonResponse(200, generateOpenApi(root)));
  }
  if (request.method === "GET" && path === "/swagger") {
    return finish(new Response(apiDocsHtml(), {
      status: 200,
      headers: {
        ...API_CORS_HEADERS,
        "content-type": "text/html; charset=utf-8"
      }
    }));
  }
  if (path.startsWith("/tools")) {
    return finish(apiErrorResponse(404, { error: "Not found" }));
  }
  const match = matchHttpRoute(root, request.method, path);
  if (match.ok) {
    let body = {};
    if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
      const rawBody = await request.text();
      if (rawBody.trim().length > 0) {
        try {
          const parsed = JSON.parse(rawBody);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return finish(apiErrorResponse(400, { error: "Request body must be a JSON object" }));
          }
          body = parsed;
        } catch {
          try {
            const parsed = Bun.YAML.parse(rawBody);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              return finish(apiErrorResponse(400, { error: "Request body must be a JSON object" }));
            }
            body = parsed;
          } catch {
            return finish(apiErrorResponse(400, { error: "Invalid JSON body" }));
          }
        }
      }
    }
    const query = parseQuery(url);
    const result = await executeHttpRouteCall(cli, match.route, match.pathParams, query, body, {
      request,
      clientIp,
      requestId,
      ...trace ? { traceId: trace.traceId, spanId: trace.spanId } : {}
    });
    if (result.ok) {
      const leafHttp = leafHttpResponseDefaults(match.route.leaf);
      const hasBody = result.response.body !== undefined;
      const methodDefault = match.route.leaf.http?.successStatus ?? defaultSuccessStatus(match.route.method, hasBody && match.route.method !== "DELETE");
      return finish(headlessSuccessToHttpResponse(result, leafHttp, methodDefault));
    }
    const obscure = httpConfig?.obscureUnexpected ?? false;
    return finish(headlessFailureToHttpResponse(result, obscure), result.invokeResult?.failureKind, result.message);
  }
  return finish(apiErrorResponse(404, { error: "Not found" }));
}
async function httpServeHttp(cli, resolved) {
  const listen = resolved ?? {
    hostname: resolveHttpListenAddress(cli.program).hostname,
    port: resolveHttpListenAddress(cli.program).port,
    trustProxy: cli.program.httpServer?.trustProxy ?? false,
    obscureUnexpected: cli.program.httpServer?.errors?.obscureUnexpected ?? false,
    log: { format: "json", access: true, errors: true, dev: false }
  };
  const server = Bun.serve({
    hostname: listen.hostname,
    port: listen.port,
    fetch: (request) => handleApiRequest(cli, request, listen)
  });
  const url = `http://${server.hostname}:${server.port}`;
  const emitter = cli.server?.emitter;
  if (emitter && listen.log.format === "text") {
    emitter.emitLifecycle(`${cli.program.key} ${cli.program.version} — HTTP API listening on ${url}`, "http.server.start");
  } else {
    emitter?.emit({
      level: "info",
      message: `HTTP API listening on ${url}`,
      action: "http.server.start",
      labels: { url }
    });
    if (!emitter) {
      process.stderr.write(`HTTP API listening on ${url}
`);
    }
  }
  await new Promise(() => {});
  throw new Error("HTTP API server stopped unexpectedly");
}

// ../bun-argsbarg/src/docs/http-guide.ts
function formatRouteLine(root, route) {
  const cliPath = route.commandPath.join(" ");
  let line = `- \`${route.method} ${route.openApiPath}\` (CLI: \`${root.key} ${cliPath}\`) — ${route.leaf.description}`;
  const opts = leafWireOptions(route.leaf);
  const flags = opts.filter((o) => o.kind === "presence" /* Presence */).map((o) => `--${o.name}`);
  if (flags.length > 0) {
    line += ` (flags: ${flags.join(", ")})`;
  }
  return line;
}
function generateHttpGuide(root) {
  const api = root.httpServer;
  if (!api) {
    throw new Error("HTTP API server not enabled");
  }
  const routes = collectHttpRoutes(root);
  const { hostname, port } = resolveHttpListenAddress(root);
  const baseUrl = `http://${hostname}:${port}`;
  const pathPrefix = resolveHttpPathPrefix(root);
  const userGlob = httpUserPathGlob(pathPrefix);
  const sampleWorkspaces = `${pathPrefix}/workspaces`;
  const lines = [
    `# HTTP API (${root.key})`,
    "",
    `${root.key} exposes user commands over HTTP REST routes derived from the CLI tree.`,
    "",
    "## Running",
    "",
    "```bash",
    `${root.key} http`,
    "```",
    "",
    `Listens on **${baseUrl}** by default (\`httpServer.host\` / \`httpServer.port\`).`,
    "",
    "Bind is localhost-only by default — use a reverse proxy for remote access.",
    "",
    "## Endpoints",
    "",
    "| Method | Path | Purpose |",
    "| --- | --- | --- |",
    "| `GET` | `/health/liveness` | Liveness — server is online and accepting requests |",
    "| `GET` | `/health/readiness` | Readiness — online plus config and `program.readiness` checks passed |",
    "| `GET` | `/openapi.json` | OpenAPI 3.1 REST paths |",
    "| `GET` | `/swagger` | Interactive Swagger UI API reference |",
    `| * | \`${userGlob}\` | Invoke user commands (method per route) |`,
    "| `OPTIONS` | `*` | CORS preflight |",
    "",
    `Discover paths from \`openapi.json\` (\`${userGlob}\`). Query binds options; POST/PUT/PATCH body binds options and \`inputSchema\` fields.`,
    "",
    "## Examples",
    "",
    "```bash",
    `curl -s ${baseUrl}/health/liveness`,
    `curl -s ${baseUrl}/health/readiness`,
    `curl -s ${baseUrl}/openapi.json`,
    `curl -s ${baseUrl}${sampleWorkspaces}`,
    `curl -s -X POST ${baseUrl}${sampleWorkspaces} \\`,
    '  -H "content-type: application/json" \\',
    `  -d '{"name":"qa2"}'`,
    "```",
    "",
    "## Responses",
    "",
    "Success: status from handler → `http.successStatus` → method default (GET 200, POST 201, DELETE 204).",
    "",
    "Handlers must use `ctx.respond()` or return a value for API/MCP tool calls.",
    "",
    'Errors use `{ "error": "..." }` with `400`, `404`, `503`, or `500`.',
    "",
    "## Logging",
    "",
    "Server logs go to **stderr** (one JSON object per line by default).",
    "",
    "- Configure with `program.log` on the program root",
    "- **`enrich`** — add custom JSON fields on top of the default line",
    "- **`serialize`** — replace the formatter and emit your own line shape",
    "",
    "See the argsbarg [logging guide](https://github.com/bdombro/bun-argsbarg/blob/main/docs/logging.md) for examples and the full `LogEnrichContext` shape.",
    ""
  ];
  if (root.appConfig?.entries && Object.keys(root.appConfig.entries).length > 0) {
    lines.push("## Configuration", "");
    lines.push(`Configure before first use: \`${root.key} configure\`.`, "", `Default config file: \`${displayAppConfigPath(root)}\`.`, "");
    for (const [key, entry] of Object.entries(root.appConfig.entries)) {
      const label = entry.title ?? defaultConfigEntryTitle(key);
      const req = entry.required === false ? "optional" : "required";
      const envNote = entry.env ? ` → env \`${entry.env}\`` : "";
      lines.push(`- **${label}** (\`${key}\`, ${req}${envNote}) — ${entry.description}`);
    }
    lines.push("");
  }
  lines.push("## REST routes", "");
  if (routes.length === 0) {
    lines.push("(No routes exposed.)", "");
  } else {
    for (const route of routes) {
      lines.push(formatRouteLine(root, route));
    }
    lines.push("");
  }
  lines.push("## Request bodies", "", "POST/PUT/PATCH bodies are a flat JSON object keyed by long option and positional names (hyphenated option names are valid keys).", "", `For HTTP clients, use **\`GET /openapi.json\`** (or **\`GET /swagger\`**) for per-route request shapes.`, "", "Varargs positionals accept a JSON array of strings (not a comma-separated string).", "Options with `format: comma-list` accept a comma-separated string or JSON array.", "Options with a schema `default` are applied when omitted.", "", `Shell invocation reference: \`${root.key} docs cli\`. Full CLI tree JSON: \`${root.key} docs cli-schema\`.`, "", "## OpenAPI", "", "The HTTP API is described in OpenAPI 3.1.", "", `- **Browse** — [${baseUrl}/swagger](${baseUrl}/swagger) (Swagger UI; loads \`/openapi.json\`)`, `- **Fetch** — \`curl -s ${baseUrl}/openapi.json\``, `- **Save offline** — \`${root.key} docs openapi --save\` → \`./docs/openapi.json\` (or \`just docgen\` in app repos)`, "", `Use the spec to discover REST paths and request/response shapes before calling \`${userGlob}\`.`, "");
  return lines.join(`
`);
}

// ../bun-argsbarg/src/configure/artifacts/mcp-config.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync, writeFileSync } from "node:fs";
import { dirname as dirname2 } from "node:path";

// ../bun-argsbarg/src/paths/host.ts
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
function userHome() {
  const user = process.env.USER ?? process.env.LOGNAME;
  return [process.env.TEST_USER_HOME, user && `/Users/${user}`, user && `/home/${user}`, process.env.USERPROFILE].find((p) => p && existsSync(p)) ?? userInfo().homedir;
}
function displayHomePath(absolutePath, home = userHome()) {
  if (home.length > 0 && absolutePath.startsWith(home)) {
    return `~${absolutePath.slice(home.length)}`;
  }
  return absolutePath;
}
function xdgConfigHome(home = userHome()) {
  return process.env.XDG_CONFIG_HOME ?? join(home, ".config");
}
function appConfigLibHome(home = userHome()) {
  return join(home, ".local", "lib");
}

// ../bun-argsbarg/src/configure/artifacts/mcp-config.ts
function expectedMcpEntry(root) {
  return { command: root.key, args: ["mcp"] };
}
function entriesEqual(a, b) {
  return a.command === b.command && JSON.stringify(a.args) === JSON.stringify(b.args);
}
function readMcpServerEntry(path, name) {
  if (!existsSync2(path))
    return;
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data.mcpServers?.[name];
  } catch {
    return;
  }
}
function installMcpServerEntry(path, name, entry) {
  const existing = readMcpServerEntry(path, name);
  if (existing) {
    if (entriesEqual(existing, entry)) {
      return "skipped-match";
    }
    process.stderr.write(`MCP server "${name}" in ${displayHomePath(path)} differs; leaving existing entry unchanged.
`);
    return "skipped-conflict";
  }
  mergeMcpConfig(path, name, entry, false);
  return "installed";
}
function mergeMcpConfig(path, name, entry, dry) {
  if (dry)
    return;
  let data = {};
  if (existsSync2(path)) {
    data = JSON.parse(readFileSync(path, "utf8"));
  }
  const servers = data.mcpServers ?? {};
  servers[name] = entry;
  data.mcpServers = servers;
  mkdirSync2(dirname2(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}
`, "utf8");
}
function removeMcpConfig(path, name, dry) {
  if (dry || !existsSync2(path))
    return [];
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!data.mcpServers?.[name])
    return [];
  delete data.mcpServers[name];
  writeFileSync(path, `${JSON.stringify(data, null, 2)}
`, "utf8");
  return [path];
}

// ../bun-argsbarg/src/configure/artifacts/paths.ts
import { dirname as dirname3, join as join2 } from "node:path";

// ../bun-argsbarg/src/skill/naming.ts
function skillDirName(programKey) {
  return programKey.replace(/[/\\\s]/g, "_");
}

// ../bun-argsbarg/src/configure/artifacts/paths.ts
function displayInstallPath(path) {
  return displayHomePath(path);
}
function resolveClaudeDesktopMcpPath(home) {
  if (process.platform === "darwin") {
    return join2(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join2(home, "AppData", "Roaming");
    return join2(appData, "Claude", "claude_desktop_config.json");
  }
  return join2(xdgConfigHome(home), "Claude", "claude_desktop_config.json");
}
function resolveInstallPaths(root) {
  const home = userHome();
  const dirName = skillDirName(root.key);
  return {
    agentsSkillDir: join2(home, ".agents", "skills", dirName),
    agentsMcpPath: join2(home, ".agents", "mcp.json"),
    mcpName: mcpServerId(root),
    skillDirName: dirName
  };
}

// ../bun-argsbarg/src/docs/mcp-resources.ts
function defaultDocsTopicResourceUri(mcpId, topicKey) {
  return `${mcpId}://docs/${topicKey}`;
}
function mcpIdFromProgram(program) {
  return program.key.replace(/[^a-zA-Z0-9]/g, "_");
}
function resolveDocsTopicResourceUri(program, topicKey) {
  return defaultDocsTopicResourceUri(mcpIdFromProgram(program), topicKey);
}
function docsMcpResources(program) {
  if (!docsEnabled(program) || program.mcpServer?.enabled !== true) {
    return [];
  }
  const docs = resolveDocsConfig(program);
  const topics = docs.topics ?? {};
  return docsUserTopicKeys(docs).map((key) => {
    const topic = topics[key];
    if (!topic) {
      throw new Error(`docs topic missing: ${key}`);
    }
    return {
      uri: resolveDocsTopicResourceUri(program, key),
      name: key,
      description: docsTopicDescription(key, topic.description),
      mimeType: "text/markdown",
      load: () => {
        const text = docsTopicText(program, key);
        return text.endsWith(`
`) ? text : `${text}
`;
      }
    };
  });
}
function reservedDocsTopicResourceUris(program) {
  if (!docsEnabled(program) || program.mcpServer?.enabled !== true) {
    return [];
  }
  const docs = resolveDocsConfig(program);
  return docsUserTopicKeys(docs).map((key) => resolveDocsTopicResourceUri(program, key));
}

// ../bun-argsbarg/src/docs/mcp-guide.ts
function appendManualClientSetup(lines, _root, serverId, entry) {
  const home = userHome();
  const claudeDesktopPath = resolveClaudeDesktopMcpPath(home);
  const mcpServersJson = JSON.stringify({ mcpServers: { [serverId]: entry } }, null, 2);
  lines.push("### Manual client setup", "", "Many clients do not read `~/.agents/mcp.json` yet. Copy the `mcpServers` entry from that file, or paste:", "", "```json", mcpServersJson, "```", "", "| Client | Config file |", "| --- | --- |", "| **Cursor** | `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project) |", "| **Claude Code** | `~/.claude.json` under `mcpServers`, or project `.mcp.json` |", "| **Claude Desktop** | See platform paths below |", "", "Restart Cursor or reload MCP after editing. Restart Claude Desktop after config changes.", "", "Claude Desktop config paths:", "", "- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`", "- **Windows:** `%APPDATA%\\Claude\\claude_desktop_config.json`", "- **Linux:** `~/.config/Claude/claude_desktop_config.json`", "", `On this machine (macOS/Linux): \`${claudeDesktopPath}\``, "");
}
function formatToolLine(root, tool) {
  const cliPath = tool.path.length > 0 ? `${root.key} ${tool.path.join(" ")}` : root.key;
  let line = `- \`${cliPath}\` — ${tool.description}`;
  const opts = leafWireOptions(tool.leaf);
  const flags = opts.filter((o) => o.kind === "presence" /* Presence */).map((o) => `--${o.name}`);
  if (flags.length > 0) {
    line += ` (flags: ${flags.join(", ")})`;
  }
  return line;
}
function generateMcpGuide(root) {
  const tools = collectMcpTools(root);
  const schemaUri = resolveMcpSchemaUri(root);
  const serverId = mcpServerId(root);
  const mcp = root.mcpServer;
  if (!mcp) {
    throw new Error("MCP server not enabled");
  }
  const caps = resolveCapabilities(root);
  const entry = expectedMcpEntry(root);
  const lines = [
    `# MCP server (${root.key})`,
    "",
    `${root.key} exposes an MCP server with features similar to the CLI.`,
    "",
    "## Installation",
    "",
    "### `.agents` auto-install",
    "",
    "When `mcpServer.enabled` is set, `configure install` merges this server into `~/.agents/mcp.json` per the https://dotagentsprotocol.com.",
    ""
  ];
  if (caps.configure) {
    lines.push(`Install the CLI first so \`${root.key}\` is on your PATH (e.g. \`brew install ${root.key}\`).`, "");
  } else {
    lines.push(`The CLI binary \`${root.key}\` must already be on your PATH.`, "");
  }
  lines.push("```bash", `${root.key} configure install`, "```", "", "Writes or updates `~/.agents/mcp.json` with a `mcpServers` entry for this app.", "");
  appendManualClientSetup(lines, root, serverId, entry);
  lines.push("### Manual `mcpServers` entry", "", "Same shape as in `~/.agents/mcp.json`:", "", "```json", JSON.stringify({
    mcpServers: {
      [serverId]: entry
    }
  }, null, 2), "```", "", "## Running directly", "", "Start the stdio MCP server without editing host config:", "", "```bash", `${root.key} mcp`, "```", "");
  lines.push("## Environment", "", "- **`shellEnv`** — on by default; captures login-shell environment at MCP startup (PATH, toolchain shims, exports). Opt out with `shellEnv: false`.", "");
  if (root.appConfig?.entries && Object.keys(root.appConfig.entries).length > 0) {
    lines.push("## Configuration", "");
    lines.push(`Configure before first use in Cursor or Claude Desktop (MCP hosts are non-interactive): \`${root.key} configure\`.`, "", `Default config file: \`${displayAppConfigPath(root)}\` (flat JSON keys).`, "");
    for (const [key, entryConfig] of Object.entries(root.appConfig.entries)) {
      const label = entryConfig.title ?? defaultConfigEntryTitle(key);
      const req = entryConfig.required === false ? "optional" : "required";
      const envNote = entryConfig.env ? ` → env \`${entryConfig.env}\`` : "";
      lines.push(`- **${label}** (\`${key}\`, ${req}${envNote}) — ${entryConfig.description}`);
    }
    lines.push("", "Example:", "", "```typescript", "config: {", "  schema: {", '    apiToken: { description: "…", env: "API_TOKEN", sensitive: true },', "  },", "},", "```", "");
  }
  lines.push("## What agents get", "", "| Mechanism | Purpose |", "|-----------|---------|", "| `tools/list` | Callable tools for exposed leaf commands |", "| `tools/call` | Runs handlers headlessly; JSON stdout becomes `structuredContent` when valid |", `| Schema resource | \`${schemaUri}\` — same JSON as \`${root.key} docs cli-schema\` |`);
  if (docsEnabled(root)) {
    const docs = resolveDocsConfig(root);
    for (const key of docsUserTopicKeys(docs)) {
      const uri2 = resolveDocsTopicResourceUri(root, key);
      lines.push(`| Docs topic \`${key}\` | \`${uri2}\` — same markdown as \`${root.key} docs ${key}\` |`);
    }
  }
  lines.push("", "## Exposed tools", "");
  if (tools.length === 0) {
    lines.push("(No MCP tools exposed.)", "");
  } else {
    for (const tool of tools) {
      lines.push(formatToolLine(root, tool));
    }
    lines.push("");
  }
  lines.push("## Tool arguments", "", "Arguments are a flat JSON object keyed by long option and positional names (hyphenated option names are valid keys).", `See \`${root.key} docs cli-schema\` or the schema resource for per-tool shapes.`, "", "Varargs positionals accept a JSON array of strings (not a comma-separated string).", "Options with `format: comma-list` accept a comma-separated string or JSON array.", "Options with a schema `default` are applied when omitted.", "", "## Protocol", "", "Stdio NDJSON JSON-RPC. Help and `docs cli-schema` are not available through tool calls.", `Run \`${root.key} docs\` for bundled user documentation.`, "");
  return lines.join(`
`);
}

// ../bun-argsbarg/src/docs/resolve.ts
var DOCS_BUILTIN_TOPIC_KEYS = ["http", "mcp", "all", "cli-schema", "cli", "openapi"];
var DOCS_ROUTER_DESCRIPTION = "Print bundled CLI documentation.";
function docsEnabled(program) {
  return program.docs?.enabled !== false;
}
function resolveDocsConfig(program) {
  return {
    description: program.docs?.description,
    topics: program.docs?.topics ?? {}
  };
}
function docsUserTopicKeys(docs) {
  return Object.keys(docs.topics ?? {});
}
function docsIncludesMcpTopic(program) {
  return docsEnabled(program) && program.mcpServer?.enabled === true;
}
function docsIncludesHttpTopic(program) {
  return docsEnabled(program) && program.httpServer?.enabled === true;
}
function docsIncludesOpenApiTopic(program) {
  return docsIncludesHttpTopic(program);
}
function docsTopicDescription(key, custom) {
  if (custom) {
    return custom;
  }
  if (key === "readme") {
    return "Print README (user guide).";
  }
  const label = key.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `Print ${label} documentation.`;
}
function docsTopicText(program, topic) {
  if (!docsEnabled(program)) {
    throw new Error("docs not enabled");
  }
  if (topic === "mcp") {
    if (!docsIncludesMcpTopic(program)) {
      throw new Error("Unknown docs topic 'mcp'.");
    }
    return generateMcpGuide(program);
  }
  if (topic === "http") {
    if (!docsIncludesHttpTopic(program)) {
      throw new Error("Unknown docs topic 'http'.");
    }
    return generateHttpGuide(program);
  }
  const topics = program.docs?.topics ?? {};
  const entry = topics[topic];
  if (!entry) {
    throw new Error(`Unknown docs topic '${topic}'.`);
  }
  return entry.text;
}
function docsTopicContent(program, topic) {
  if (topic === "cli-schema") {
    return cliSchemaJson(program);
  }
  if (topic === "openapi") {
    if (!docsIncludesOpenApiTopic(program)) {
      throw new Error("Unknown docs topic 'openapi'.");
    }
    return openApiJson(program);
  }
  if (topic === "cli") {
    return generateCliGuide(program);
  }
  const text = docsTopicText(program, topic);
  return text.endsWith(`
`) ? text : `${text}
`;
}
function printDocsTopic(program, topic) {
  process.stdout.write(docsTopicContent(program, topic));
}

// ../bun-argsbarg/src/docs/save.ts
import { mkdirSync as mkdirSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname4, join as join3 } from "node:path";

// ../bun-argsbarg/src/skill/hint.ts
var MARKDOWN_FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
function generatedFileHtmlComment(source) {
  return `<!-- Generated by ${source}; do not edit. -->

`;
}
function insertGeneratedHint(content, hint, options) {
  if (options?.afterFrontmatter) {
    const match = content.match(MARKDOWN_FRONTMATTER_RE);
    if (match) {
      return `${match[0]}${hint}${content.slice(match[0].length)}`;
    }
  }
  return `${hint}${content}`;
}
function skillBundleHint(program) {
  return generatedFileHtmlComment(`${program.key} mcp bundle`);
}
function applyPluginSkillHint(program, skillMd) {
  return insertGeneratedHint(skillMd, skillBundleHint(program), { afterFrontmatter: true });
}

// ../bun-argsbarg/src/docs/save.ts
var DOCS_SAVE_DIR = "docs";
var DOCS_GENERATED_SAVE_TOPICS = ["mcp", "cli", "http"];
function docsTopicIsGeneratedByArgsbarg(topic) {
  return DOCS_GENERATED_SAVE_TOPICS.includes(topic);
}
function docsSaveGeneratedHint(program, topic) {
  return generatedFileHtmlComment(`${program.key} docs ${topic} --save`);
}
function applySaveGeneratedHint(program, topic, content) {
  if (!docsTopicIsGeneratedByArgsbarg(topic)) {
    return content;
  }
  const hint = docsSaveGeneratedHint(program, topic);
  return insertGeneratedHint(content, hint);
}
function docsTopicContentForSave(program, topic) {
  return applySaveGeneratedHint(program, topic, docsTopicContent(program, topic));
}
function docsSaveFilename(topic) {
  if (topic === "cli-schema") {
    return "cli-schema.json";
  }
  if (topic === "openapi") {
    return "openapi.json";
  }
  return `${topic}.md`;
}
function docsSaveRelativePath(topic, _program) {
  return join3(DOCS_SAVE_DIR, docsSaveFilename(topic));
}
function saveDocsTopic(program, topic) {
  const rel = docsSaveRelativePath(topic, program);
  const abs = join3(process.cwd(), rel);
  mkdirSync3(dirname4(abs), { recursive: true });
  writeFileSync2(abs, docsTopicContentForSave(program, topic), "utf8");
  return rel;
}

// ../bun-argsbarg/src/docs/builtin.ts
var DOCS_SAVE_OPTION = {
  name: "save",
  description: "Write documentation to ./docs/.",
  kind: "presence" /* Presence */
};
function runDocsTopic(program, topic, ctx) {
  if (ctx.hasFlag("save")) {
    process.stdout.write(`${saveDocsTopic(program, topic)}
`);
    return;
  }
  printDocsTopic(program, topic);
}
function docsLeaf(program, key, description) {
  return {
    key,
    description,
    options: [DOCS_SAVE_OPTION],
    mcpTool: { enabled: false },
    handler: (ctx) => {
      runDocsTopic(program, key, ctx);
    }
  };
}
function docsRouterNotes() {
  return "Topics print to stdout. Add --save to write files under ./docs/.";
}
function cliBuiltinDocsGroup(program) {
  const docs = resolveDocsConfig(program);
  const topics = docs.topics ?? {};
  const leaves = [];
  for (const key of docsUserTopicKeys(docs)) {
    const topic = topics[key];
    if (!topic) {
      throw new Error(`docs topic missing: ${key}`);
    }
    leaves.push(docsLeaf(program, key, docsTopicDescription(key, topic.description)));
  }
  if (docsIncludesMcpTopic(program)) {
    leaves.push(docsLeaf(program, "mcp", "Print MCP server setup and tool guidance."));
  }
  if (docsIncludesHttpTopic(program)) {
    leaves.push(docsLeaf(program, "http", "Print HTTP API setup and tool guidance."));
  }
  if (docsIncludesOpenApiTopic(program)) {
    leaves.push(docsLeaf(program, "openapi", "Print the HTTP OpenAPI 3.1 document as JSON."));
  }
  leaves.push(docsLeaf(program, "cli-schema", "Print the full CLI command tree as JSON."), docsLeaf(program, "cli", "Print the full command reference as markdown."));
  return {
    key: "docs",
    description: docs.description ?? DOCS_ROUTER_DESCRIPTION,
    notes: docsRouterNotes(),
    options: [DOCS_SAVE_OPTION],
    commands: leaves
  };
}
function cliBuiltinDocsGroupIfEnabled(program) {
  if (!docsEnabled(program)) {
    return null;
  }
  return cliBuiltinDocsGroup(program);
}

// ../bun-argsbarg/src/builtins/completion-group.ts
function cliBuiltinCompletionGroup(program) {
  const appName = program.key;
  const router = {
    key: "completion",
    cli: { hidden: true },
    description: "Generate the autocompletion script for shells.",
    commands: [
      {
        key: "bash",
        description: "Print a bash tab-completion script.",
        notes: "Homebrew installs completions during `brew install` via generate_completions_from_executable.\n\n" + `Ensure your shell loads Homebrew completions:
` + `  https://docs.brew.sh/Shell-Completion

` + `Try this session only:

` + `  source <(${appName} completion bash)`,
        handler: () => {}
      },
      {
        key: "zsh",
        description: "Print a zsh tab-completion script.",
        notes: `Homebrew installs completions to $(brew --prefix)/share/zsh/site-functions.

` + `Ensure brew shellenv + compinit are configured:
` + `  https://docs.brew.sh/Shell-Completion

` + `Try this session only:

` + `  eval "$(${appName} completion zsh)"`,
        handler: () => {}
      },
      {
        key: "fish",
        description: "Print a fish tab-completion script.",
        notes: `Homebrew installs completions to $(brew --prefix)/share/fish/vendor_completions.d.

` + `See: https://docs.brew.sh/Shell-Completion

` + `Try this session only:

` + `  ${appName} completion fish | source`,
        handler: () => {}
      }
    ]
  };
  router.notes = `Completions are installed by Homebrew during formula install.

` + "See: https://docs.brew.sh/Shell-Completion";
  return router;
}

// ../bun-argsbarg/src/configure/artifacts/target-base.ts
class InstallTarget {
  defaultIncludedInAll() {
    return false;
  }
  applyDetected(_paths, _root, _out) {}
  detectedForSnapshot(detected) {
    return this.isDetectedFromSnapshot(detected);
  }
  statusLine(paths, root, detected) {
    if (!this.isDetectedFromInstalled(detected))
      return;
    return this.formatStatusLine(paths, root);
  }
  isDetectedFromInstalled(detected) {
    return this.isDetectedFromSnapshot(detected);
  }
  planInstall(ctx) {
    if (!ctx.include(this.key))
      return [];
    return this.buildInstallActions(ctx);
  }
  planUninstall(ctx) {
    if (!ctx.include(this.key))
      return [];
    if (!this.isDetectedFromSnapshot(ctx.detected))
      return [];
    return this.buildUninstallActions(ctx);
  }
  contributeStatus(paths, root, detected, status) {
    const line = this.statusLine(paths, root, detected);
    if (!line)
      return;
    this.assignStatusLine(status, line);
  }
}

// ../bun-argsbarg/src/configure/artifacts/target-mcp-json.ts
function mcpConfigHasServer(path, name) {
  return readMcpServerEntry(path, name) !== undefined;
}

class McpJsonInstallTarget extends InstallTarget {
  key;
  actionKind;
  category = "mcp";
  spec;
  constructor(spec) {
    super();
    this.spec = spec;
    this.key = spec.key;
    this.actionKind = spec.actionKind;
  }
  isAvailable(root, paths) {
    return this.spec.isAvailable(root, paths);
  }
  isDetected(paths, _root) {
    return mcpConfigHasServer(this.spec.configPath(paths), paths.mcpName);
  }
  applyDetected(paths, root, out) {
    out[this.spec.detectedKey] = this.isDetected(paths, root);
  }
  isDetectedFromSnapshot(detected) {
    return detected[this.spec.detectedKey];
  }
  formatStatusLine(paths, _root) {
    const path = displayInstallPath(this.spec.configPath(paths));
    if (this.spec.statusIncludesServer) {
      return `${path} (server "${paths.mcpName}")`;
    }
    return path;
  }
  assignStatusLine(status, line) {
    status[this.spec.statusField] = line;
  }
  preflight(_ctx) {
    return null;
  }
  buildInstallActions(ctx) {
    const configPath = this.spec.configPath(ctx.paths);
    const entry = expectedMcpEntry(ctx.root);
    const displayPath = displayInstallPath(configPath);
    return [
      {
        kind: this.actionKind,
        summary: `${this.spec.label}: ${displayPath}`,
        message: `Merging MCP server "${ctx.paths.mcpName}" into ${displayPath}`,
        run: () => {
          const result = installMcpServerEntry(configPath, ctx.paths.mcpName, entry);
          if (result === "installed") {
            process.stdout.write(`Registered MCP server in ${displayPath}
`);
          }
          return result === "installed" ? [configPath] : [];
        }
      }
    ];
  }
  buildUninstallActions(ctx) {
    const configPath = this.spec.configPath(ctx.paths);
    const displayPath = displayInstallPath(configPath);
    return [
      {
        kind: this.actionKind,
        summary: `${this.spec.label}: ${displayPath}`,
        message: `Removing MCP server "${ctx.paths.mcpName}" from ${displayPath}`,
        run: () => {
          const changed = removeMcpConfig(configPath, ctx.paths.mcpName, ctx.dry);
          if (changed.length > 0 && !ctx.dry) {
            process.stdout.write(`Removed MCP server from ${displayPath}
`);
          }
          return changed;
        }
      }
    ];
  }
}

// ../bun-argsbarg/src/configure/artifacts/targets/agents-mcp.ts
var agentsMcpTarget = new McpJsonInstallTarget({
  key: "agentsMcp",
  actionKind: "agents-mcp",
  label: "agents mcp",
  configPath: (p) => p.agentsMcpPath,
  detectedKey: "agentsMcp",
  statusField: "agentsMcp",
  isAvailable: (root) => root.mcpServer?.enabled === true
});

// ../bun-argsbarg/src/configure/artifacts/binary-placement.ts
import { accessSync, constants, realpathSync } from "node:fs";
import { delimiter, join as join4 } from "node:path";
function resolvePathCommand(key) {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir)
      continue;
    const candidate = join4(dir, key);
    try {
      accessSync(candidate, constants.F_OK);
      return realpathSync(candidate);
    } catch {}
  }
  const found = Bun.which(key);
  if (found === null)
    return;
  try {
    return realpathSync(found);
  } catch {
    return found;
  }
}
function realpathOrSelf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
function isExternallyManagedBinary(key, execPath = process.execPath) {
  const resolved = resolvePathCommand(key);
  if (!resolved)
    return false;
  return resolved === realpathOrSelf(execPath);
}

// ../bun-argsbarg/src/configure/artifacts/targets/app.ts
class AppInstallTarget extends InstallTarget {
  key = "app";
  actionKind = "app";
  category = "core";
  defaultIncludedInAll() {
    return false;
  }
  isAvailable(_root, _paths) {
    return true;
  }
  isDetected(_paths, root) {
    return isExternallyManagedBinary(root.key) || false;
  }
  applyDetected(_paths, root, out) {
    out.app = isExternallyManagedBinary(root.key);
  }
  isDetectedFromSnapshot(detected) {
    return detected.app;
  }
  formatStatusLine(_paths, root) {
    if (isExternallyManagedBinary(root.key)) {
      return "system (PATH)";
    }
    return "not installed (use Homebrew)";
  }
  assignStatusLine(status, line) {
    status.app = line;
  }
  buildInstallActions(_ctx) {
    return [];
  }
  buildUninstallActions(_ctx) {
    return [];
  }
}
var appTarget = new AppInstallTarget;

// ../bun-argsbarg/src/configure/artifacts/targets/configure.ts
class ConfigureInstallTarget extends InstallTarget {
  key = "configure";
  actionKind = "configure";
  category = "core";
  isAvailable(_root, _paths) {
    return true;
  }
  isDetected(_paths, root) {
    return appConfigInstalled(root);
  }
  applyDetected(_paths, _root, _out) {}
  isDetectedFromSnapshot(detected) {
    return detected.appConfig ?? false;
  }
  formatStatusLine(_paths, root) {
    return displayAppConfigPath(root);
  }
  assignStatusLine(_status, _line) {}
  buildInstallActions(_ctx) {
    return [];
  }
  buildUninstallActions(ctx) {
    return [
      {
        kind: "configure",
        summary: `app config: ${displayAppConfigPath(ctx.root)}`,
        message: `Removing app config ${displayAppConfigPath(ctx.root)}`,
        run: () => uninstallAppConfig(ctx.root, ctx.dry)
      }
    ];
  }
}
var configureTarget = new ConfigureInstallTarget;

// ../bun-argsbarg/src/configure/artifacts/targets/skill.ts
import { existsSync as existsSync5 } from "node:fs";

// ../bun-argsbarg/src/configure/artifacts/target-skill.ts
import { existsSync as existsSync4 } from "node:fs";

// ../bun-argsbarg/src/configure/artifacts/uninstall.ts
import { existsSync as existsSync3, rmSync } from "node:fs";
function buildUninstallPlan(root, paths, opts) {
  return buildUninstallPlanFromTargets(root, paths, opts);
}
function uninstallSkillDir(dir, dry) {
  if (!existsSync3(dir))
    return [];
  if (!dry) {
    rmSync(dir, { recursive: true, force: true });
    process.stdout.write(`Removed skill from ${displayHomePath(dir)}/
`);
  }
  return [`${dir}/`];
}

// ../bun-argsbarg/src/configure/artifacts/target-skill.ts
class SkillInstallTarget extends InstallTarget {
  key;
  actionKind;
  category = "skill";
  uninstallPrefix;
  spec;
  constructor(spec) {
    super();
    this.spec = spec;
    this.key = spec.key;
    this.actionKind = spec.actionKind;
    this.uninstallPrefix = spec.uninstallPrefix;
  }
  isAvailable(root, paths) {
    return this.spec.isAvailable(root, paths);
  }
  isDetected(paths, _root) {
    return existsSync4(this.spec.skillDir(paths));
  }
  applyDetected(paths, root, out) {
    out[this.spec.detectedKey] = this.isDetected(paths, root);
  }
  isDetectedFromSnapshot(detected) {
    return detected[this.spec.detectedKey];
  }
  formatStatusLine(paths, _root) {
    return `${displayInstallPath(this.spec.skillDir(paths))}/`;
  }
  assignStatusLine(status, line) {
    status[this.spec.statusField] = line;
  }
  skillDir(paths) {
    return this.spec.skillDir(paths);
  }
  buildInstallActions(_ctx) {
    return [];
  }
  buildUninstallActions(ctx) {
    const dir = this.spec.skillDir(ctx.paths);
    return [
      {
        kind: this.actionKind,
        summary: `${this.uninstallPrefix}: ${displayInstallPath(dir)}/`,
        message: `Removing ${this.spec.label.toLowerCase()} ${displayInstallPath(dir)}/`,
        run: () => uninstallSkillDir(dir, ctx.dry)
      }
    ];
  }
}

// ../bun-argsbarg/src/configure/artifacts/targets/skill.ts
var skillTarget = new SkillInstallTarget({
  key: "skill",
  actionKind: "agent-skill",
  label: "Agent skill",
  uninstallPrefix: "agent skill",
  skillDir: (p) => p.agentsSkillDir,
  detectedKey: "skill",
  statusField: "skill",
  isAvailable: (_root, p) => existsSync5(p.agentsSkillDir)
});

// ../bun-argsbarg/src/configure/artifacts/targets/index.ts
var INSTALL_TARGETS = [appTarget, skillTarget, agentsMcpTarget, configureTarget];

// ../bun-argsbarg/src/configure/artifacts/target-registry.ts
var INSTALL_ARTIFACT_KEYS = INSTALL_TARGETS.map((t) => t.key);
var SKILL_KEYS = INSTALL_TARGETS.filter((t) => t.category === "skill").map((t) => t.key);
var MCP_KEYS = INSTALL_TARGETS.filter((t) => t.category === "mcp").map((t) => t.key);
var ACTION_KIND_TO_ARTIFACT = Object.fromEntries(INSTALL_TARGETS.map((t) => [t.actionKind, t.key]));
var targetByKey = new Map(INSTALL_TARGETS.map((t) => [t.key, t]));
function installTargetForKey(key) {
  return targetByKey.get(key);
}
function isMcpArtifactKey(key) {
  return installTargetForKey(key)?.category === "mcp";
}
function mcpServerRequiredForArtifact(key, mcpServerEnabled) {
  return !isMcpArtifactKey(key) || mcpServerEnabled;
}

// ../bun-argsbarg/src/configure/artifacts/target-effective.ts
function resolveInstallTargetSpec(spec, defaults) {
  if (spec === undefined) {
    return { ...defaults };
  }
  if (typeof spec === "boolean") {
    return {
      enabled: spec,
      includedInAll: spec ? defaults.includedInAll : false
    };
  }
  return {
    enabled: spec.enabled ?? defaults.enabled,
    includedInAll: spec.includedInAll ?? defaults.includedInAll
  };
}
function artifactDefaults(key, program) {
  if (key === "skill") {
    return { enabled: false, includedInAll: false };
  }
  if (key === "agentsMcp") {
    const on = program?.mcpServer?.enabled === true;
    return { enabled: on, includedInAll: on };
  }
  const target = installTargetForKey(key);
  if (!mcpServerRequiredForArtifact(key, program?.mcpServer?.enabled === true)) {
    return { enabled: false, includedInAll: false };
  }
  return { enabled: true, includedInAll: target?.defaultIncludedInAll() ?? false };
}
function resolveEffectiveInstallTargets(configure, program) {
  const user = configure?.targets;
  const out = {};
  for (const key of INSTALL_ARTIFACT_KEYS) {
    const userSpec = key === "skill" || key === "agentsMcp" ? undefined : user?.[key];
    out[key] = resolveInstallTargetSpec(userSpec, artifactDefaults(key, program));
  }
  return out;
}
function mcpCategoryEnabled(root) {
  return resolveCapabilities(root).mcp;
}
function resolveInstallPlanMode(opts) {
  if (opts.reinstall)
    return "refresh";
  if (opts.uninstall)
    return opts.all ? "uninstall-all" : "uninstall-scoped";
  if (opts.all)
    return "install-all";
  return "install-scoped";
}

// ../bun-argsbarg/src/configure/artifacts/target-scope.ts
function emptyInstalledArtifacts() {
  return {
    app: false,
    skill: false,
    agentsMcp: false
  };
}
function detectInstalledArtifacts(paths, root) {
  const out = emptyInstalledArtifacts();
  for (const target of INSTALL_TARGETS) {
    target.applyDetected(paths, root, out);
  }
  return out;
}
function resolveInstallScope(opts) {
  return {
    all: opts.all,
    skill: opts.skill,
    mcp: opts.mcp,
    configure: opts.configure,
    uninstall: opts.uninstall
  };
}
function buildDetectedSnapshot(root, paths) {
  const base = detectInstalledArtifacts(paths, root);
  return {
    ...base,
    appConfig: appConfigFileExists(root)
  };
}
function targetExplicitlyConfigured(user, key) {
  if (key === "skill" || key === "agentsMcp")
    return false;
  return user?.[key] !== undefined;
}
function agentCategoryInScope(key, categoryKeys, category, effective, targets, root) {
  if (!categoryKeys.includes(key))
    return false;
  if (!effective[key].enabled)
    return false;
  if (category === "mcp" && !resolveCapabilities(root).mcp)
    return false;
  return effective[key].includedInAll || targetExplicitlyConfigured(targets, key);
}
function isArtifactInScope(key, scope, effective, mode, root, targets) {
  const userTargets = targets ?? root.configure?.targets;
  if (mode === "uninstall-all") {
    return true;
  }
  if (mode === "refresh") {
    return effective[key].enabled;
  }
  if (mode === "install-all") {
    const t = effective[key];
    return t.enabled && t.includedInAll;
  }
  if (mode === "uninstall-scoped" || mode === "install-scoped") {
    if (!effective[key].enabled)
      return false;
    let inScope = false;
    if (scope.skill) {
      inScope = inScope || agentCategoryInScope(key, SKILL_KEYS, "skill", effective, userTargets, root);
    }
    if (scope.mcp) {
      inScope = inScope || agentCategoryInScope(key, MCP_KEYS, "mcp", effective, userTargets, root);
    }
    if (scope.configure && key === "configure") {
      inScope = true;
    }
    return inScope;
  }
  return false;
}
function shouldIncludeArtifact(key, root, paths, scope, mode, effective, detected) {
  const target = installTargetForKey(key);
  const targets = root.configure?.targets;
  if (key !== "configure" && target && !target.isAvailable(root, paths)) {
    return false;
  }
  if (key === "configure" && !root.appConfig) {
    return false;
  }
  if (mode === "refresh" && detected) {
    if (key === "app") {} else if (!detected[key]) {
      return false;
    }
  }
  if ((mode === "uninstall-all" || mode === "uninstall-scoped") && detected) {
    const det = detected[key];
    if (key === "configure") {
      if (!det)
        return false;
    } else if (mode === "uninstall-scoped") {
      if (!isArtifactInScope(key, scope, effective, mode, root, targets))
        return false;
      if (!det)
        return false;
    } else if (!det) {
      return false;
    }
  }
  if (mode === "uninstall-all") {
    return true;
  }
  if (mode === "uninstall-scoped") {
    return isArtifactInScope(key, scope, effective, mode, root, targets);
  }
  if (mode === "refresh") {
    if (key === "app")
      return false;
    return effective[key].enabled;
  }
  return isArtifactInScope(key, scope, effective, mode, root, targets);
}
function buildTargetPlanContext(root, paths, opts, detected) {
  const effective = resolveEffectiveInstallTargets(root.configure, root);
  const mode = resolveInstallPlanMode(opts);
  const scope = resolveInstallScope(opts);
  const detPartial = Object.fromEntries(INSTALL_TARGETS.map((t) => [t.key, t.detectedForSnapshot(detected)]));
  const include = (key) => shouldIncludeArtifact(key, root, paths, scope, mode, effective, detPartial);
  return {
    root,
    paths,
    opts,
    dry: !!opts.dry,
    detected,
    effective,
    scope,
    mode,
    include
  };
}
function resolveInstallTargetPreview(program, paths) {
  const effective = resolveEffectiveInstallTargets(program.configure, program);
  const keysForScope = (scope, mode) => INSTALL_ARTIFACT_KEYS.filter((key) => shouldIncludeArtifact(key, program, paths, scope, mode, effective));
  return {
    all: keysForScope({ all: true }, "install-all"),
    mcp: keysForScope({ mcp: true }, "install-scoped"),
    skill: keysForScope({ skill: true }, "install-scoped")
  };
}

// ../bun-argsbarg/src/configure/artifacts/target-plan-build.ts
function buildInstallPlanFromTargets(root, paths, opts) {
  const detected = buildDetectedSnapshot(root, paths);
  const ctx = buildTargetPlanContext(root, paths, opts, detected);
  const actions = [];
  const mcpEnabled = mcpCategoryEnabled(root);
  for (const target of INSTALL_TARGETS) {
    if (target.category === "mcp" && !mcpEnabled)
      continue;
    actions.push(...target.planInstall(ctx));
  }
  return actions;
}
function buildUninstallPlanFromTargets(root, paths, opts) {
  const detected = buildDetectedSnapshot(root, paths);
  const ctx = buildTargetPlanContext(root, paths, opts, detected);
  const actions = [];
  for (const target of INSTALL_TARGETS) {
    if (target.key === "configure")
      continue;
    actions.push(...target.planUninstall(ctx));
  }
  const configure = installTargetForKey("configure");
  if (configure) {
    actions.push(...configure.planUninstall(ctx));
  }
  return actions;
}

// ../bun-argsbarg/src/configure/artifacts/plan.ts
function buildUpdatePlan(root, paths, opts) {
  const refresh = buildInstallPlanFromTargets(root, paths, {
    ...opts,
    reinstall: true,
    all: true
  });
  if (refresh.length > 0) {
    return refresh;
  }
  return buildInstallPlanFromTargets(root, paths, { ...opts, reinstall: false, all: true });
}

// ../bun-argsbarg/src/configure/artifacts/target-detect.ts
function buildInstallStatus(paths, detected, root) {
  const status = {};
  for (const target of INSTALL_TARGETS) {
    target.contributeStatus(paths, root, detected, status);
  }
  return status;
}
// ../bun-argsbarg/src/configure/artifacts/status.ts
function installOut(msg, opts) {
  if (opts.json)
    return;
  process.stdout.write(`${msg}
`);
}
function installErr(msg) {
  process.stderr.write(`${msg}
`);
}
function printInstallStatus(root, opts) {
  const paths = resolveInstallPaths(root);
  const detected = detectInstalledArtifacts(paths, root);
  const status = buildInstallStatus(paths, detected, root);
  if (opts.json) {
    const preview = resolveInstallTargetPreview(root, paths);
    const json = {
      effective: {
        all: preview.all,
        mcp: preview.mcp,
        skill: preview.skill
      }
    };
    if (status.app)
      json.app = status.app;
    if (status.skill)
      json.skill = status.skill;
    if (status.agentsMcp)
      json.agentsMcp = status.agentsMcp;
    process.stdout.write(`${JSON.stringify(json, null, 2)}
`);
    return;
  }
  installOut(`Installed artifacts for ${root.key}:`, opts);
  const lines = [
    ["app", status.app],
    ["agent skill", status.skill],
    [".agents mcp", status.agentsMcp]
  ];
  let any = false;
  for (const [label, value] of lines) {
    if (value) {
      installOut(`  ${label}: ${value}`, opts);
      any = true;
    }
  }
  if (!any) {
    installOut("  (none detected)", opts);
  }
  const configStatus = appConfigStatus(root);
  if (configStatus) {
    installOut(`  app config: ${configStatus}`, opts);
  }
}

// ../bun-argsbarg/src/configure/index.ts
function appConfigHasEntries(program) {
  const entries = program.appConfig?.entries;
  return !!entries && Object.keys(entries).length > 0;
}
function configureHookContext(root, paths) {
  return {
    program: root,
    dry: false,
    paths: {
      agentsSkillDir: paths.agentsSkillDir,
      agentsMcpPath: paths.agentsMcpPath,
      mcpName: paths.mcpName,
      skillDirName: paths.skillDirName
    }
  };
}
async function runConfigureLifecycleHook(hook, root, paths) {
  if (!hook)
    return;
  await hook(configureHookContext(root, paths));
}
function executePlan(actions) {
  for (const action of actions) {
    action.run();
  }
}
function runInstallWizard(root) {
  if (!appConfigHasEntries(root))
    return;
  const { resolved } = bootstrapAppConfig(root, { validateFile: false });
  const missing = missingRequiredConfig(root, resolved);
  if (process.stdin.isTTY) {
    if (missing.length === 0)
      return;
    runConfigure(root, { context: "after-install", showHeading: true, rePromptAll: false });
    return;
  }
  if (missing.length > 0) {
    installErr(formatMissingConfigMessage(root, missing));
    process.exit(1);
  }
}
function confirmUninstall(root, yes) {
  if (yes || !process.stdin.isTTY)
    return;
  process.stderr.write(`Remove agent artifacts for ${root.key}? [y/N]: `);
  const ans = readPromptLine().trim().toLowerCase();
  if (ans !== "y" && ans !== "yes") {
    process.exit(0);
  }
}
async function cliConfigureInstall(root) {
  const paths = resolveInstallPaths(root);
  const installOpts = { reinstall: true, all: true };
  try {
    const bootstrapped = ensureAppConfigFile(root, false);
    if (bootstrapped) {
      process.stdout.write(`Initialized config: ${displayAppConfigPath(root)}
`);
    }
    const actions = buildUpdatePlan(root, paths, installOpts);
    executePlan(actions);
    runInstallWizard(root);
    await runConfigureLifecycleHook(root.configure?.afterInstall, root, paths);
  } catch (err) {
    installErr(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  process.exit(0);
}
async function cliConfigureUninstall(root, opts) {
  const paths = resolveInstallPaths(root);
  const uninstallOpts = { uninstall: true, all: true };
  confirmUninstall(root, !!opts.yes);
  try {
    await runConfigureLifecycleHook(root.configure?.beforeUninstall, root, paths);
    const actions = buildUninstallPlan(root, paths, uninstallOpts);
    executePlan(actions);
  } catch (err) {
    installErr(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  process.exit(0);
}
function cliConfigureStatus(root, opts) {
  printInstallStatus(root, { status: true, json: opts.json });
  process.exit(0);
}

// ../bun-argsbarg/src/builtins/config.ts
var JSON_OPTION = {
  name: "json",
  description: "Emit JSON (compact).",
  kind: "presence" /* Presence */
};
var PRETTY_OPTION = {
  name: "pretty",
  description: "Pretty-print JSON (requires --json).",
  kind: "presence" /* Presence */
};
function configGetOutput(program, key, json, pretty) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    return;
  }
  const { resolved } = bootstrapAppConfig(program, { validateFile: true });
  const entries = appConfig.entries;
  if (key !== undefined) {
    if (!(key in entries)) {
      process.stderr.write(`Unknown configuration key: ${key}
`);
      process.exit(1);
    }
    const entry = entries[key];
    if (!entry) {
      process.exit(1);
    }
    const value = resolved[key];
    if (json) {
      const out2 = configEntrySensitive(key, entry) && value !== undefined && String(value).length > 0 ? { set: true } : value ?? null;
      const space = pretty ? 2 : undefined;
      process.stdout.write(`${JSON.stringify(out2, null, space)}
`);
      return;
    }
    if (configEntrySensitive(key, entry)) {
      const set = value !== undefined && value !== null && String(value).length > 0;
      process.stdout.write(set ? `REDACTED
` : `(not set)
`);
      return;
    }
    if (value === undefined) {
      process.stdout.write(`(not set)
`);
      return;
    }
    if (typeof value === "object") {
      process.stdout.write(`${JSON.stringify(value)}
`);
      return;
    }
    process.stdout.write(`${String(value)}
`);
    return;
  }
  const out = {};
  for (const [k, entry] of Object.entries(entries)) {
    const value = resolved[k];
    if (configEntrySensitive(k, entry)) {
      out[k] = value !== undefined && value !== null && String(value).length > 0 ? json ? { set: true } : "REDACTED" : json ? null : "(not set)";
    } else {
      out[k] = value ?? (json ? null : "(not set)");
    }
  }
  if (json) {
    const space = pretty ? 2 : undefined;
    process.stdout.write(`${JSON.stringify(out, null, space)}
`);
    return;
  }
  for (const [k, v] of Object.entries(out)) {
    const title = entries[k]?.title ?? defaultConfigEntryTitle(k);
    process.stdout.write(`${title}: ${String(v)}
`);
  }
}
var FROM_ENV_OPTION = {
  name: "from-env",
  description: "Bind this key to its mapped environment variable (no literal value stored).",
  kind: "presence" /* Presence */
};
function configSetFromEnv(program, key) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    return;
  }
  const entry = appConfig.entries[key];
  if (!entry?.env) {
    process.stderr.write(`Configuration key '${key}' has no env mapping for --from-env.
`);
    process.exit(1);
  }
  const hostEnv = captureMappedHostEnv(program);
  const { fileData } = bootstrapAppConfig(program, { validateFile: true });
  let next = clearFileValue(fileData, key);
  next = setBinding(next, key, "env");
  writeAppConfigFile(program, next, { partial: true });
  const resolved = resolveAppConfig(program, next, hostEnv);
  exportConfigToEnv(program, resolved, hostEnv);
}
function configSetRun(program, key, rawValue, useJson) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    return;
  }
  const entries = appConfig.entries;
  if (!(key in entries)) {
    process.stderr.write(`Unknown configuration key: ${key}
`);
    process.exit(1);
  }
  const jsonSchema = effectiveJsonSchema(program);
  if (!jsonSchema) {
    process.stderr.write(`Internal error: missing effective jsonSchema.
`);
    process.exit(1);
  }
  const propSchema = configPropertySchema(jsonSchema, key);
  let parsed;
  try {
    parsed = parseConfigSetValue(rawValue, propSchema, jsonSchema, useJson);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}
`);
    process.exit(1);
  }
  const hostEnv = captureMappedHostEnv(program);
  const { fileData } = bootstrapAppConfig(program, { validateFile: true });
  const next = setBinding({ ...fileData, [key]: parsed }, key, "file");
  writeAppConfigFile(program, next, { partial: true });
  const resolved = resolveAppConfig(program, next, hostEnv);
  exportConfigToEnv(program, resolved, hostEnv);
}
function configGetLeaf(program) {
  return {
    key: "get",
    description: "Print resolved configuration value(s).",
    options: [JSON_OPTION, PRETTY_OPTION],
    positionals: [
      {
        name: "key",
        description: "Schema key to read (omit for all keys).",
        kind: "string" /* String */,
        argMin: 0,
        argMax: 1
      }
    ],
    handler: (ctx) => {
      const key = ctx.args[0];
      configGetOutput(program, key, ctx.hasFlag("json"), ctx.hasFlag("pretty"));
    }
  };
}
function configSetLeaf(program, mcpSetEnabled) {
  return {
    key: "set",
    description: "Write one configuration key to the config file.",
    options: [JSON_OPTION, FROM_ENV_OPTION],
    mcpTool: mcpSetEnabled ? undefined : { enabled: false },
    positionals: [
      {
        name: "key",
        description: "Schema key to write.",
        kind: "string" /* String */,
        argMin: 1,
        argMax: 1
      },
      {
        name: "value",
        description: "Value to store (comma-separated or JSON for primitive arrays; --json for objects and nested arrays).",
        kind: "string" /* String */,
        argMin: 0,
        argMax: 1
      }
    ],
    handler: (ctx) => {
      const key = ctx.args[0];
      if (!key) {
        process.stderr.write(`configure set requires a key.
`);
        process.exit(1);
      }
      if (ctx.hasFlag("from-env")) {
        const raw2 = ctx.args[1];
        if (raw2 !== undefined && raw2.length > 0) {
          process.stderr.write(`configure set --from-env does not accept a value.
`);
          process.exit(1);
        }
        configSetFromEnv(program, key);
        return;
      }
      const raw = ctx.args[1];
      if (raw === undefined || raw.length === 0) {
        if (!ctx.hasFlag("json")) {
          process.stderr.write(`configure set requires a value (or --from-env).
`);
          process.exit(1);
        }
        process.stderr.write(`configure set requires a value.
`);
        process.exit(1);
      }
      configSetRun(program, key, raw, ctx.hasFlag("json"));
    }
  };
}
function configureConfigSubcommands(program, mcpSetEnabled = configMcpSetEnabled(program)) {
  if (!program.appConfig) {
    throw new Error("configure config subcommands require program.appConfig");
  }
  return [configGetLeaf(program), configSetLeaf(program, mcpSetEnabled)];
}

// ../bun-argsbarg/src/builtins/configure-copy.ts
var LABEL = {
  mcp: { prose: "MCP config", short: "MCP" },
  config: { prose: "app config", short: "config" }
};
function enabledKinds(program, caps) {
  const kinds = [];
  if (caps.mcp && program.mcpServer?.enabled)
    kinds.push("mcp");
  if (program.appConfig && Object.keys(program.appConfig.entries).length > 0)
    kinds.push("config");
  return kinds;
}
function joinEnglish(items) {
  if (items.length === 0)
    return "agent artifacts";
  if (items.length === 1)
    return items[0] ?? "agent artifacts";
  if (items.length === 2)
    return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
function prose(program, caps) {
  return joinEnglish(enabledKinds(program, caps).map((k) => LABEL[k].prose));
}
function configureCommandDescription(program, caps) {
  return `Set up ${prose(program, caps)} for this app (binary via Homebrew).`;
}
function configureCommandNotes(program, _caps) {
  const app = program.key;
  const lines = [
    "Set up agent artifacts after the binary is installed via Homebrew (see README for tap install).",
    "",
    "Homebrew installs the binary and shell completions only. Agent artifacts live under ~/.agents and are not written during brew install.",
    "",
    "After install or upgrade:",
    `  ${app} configure install`,
    "",
    "Upgrade:",
    `  brew upgrade ${app}`,
    `  ${app} configure install`,
    "",
    "Shell completions are installed by Homebrew during brew install.",
    "See: https://docs.brew.sh/Shell-Completion",
    "",
    "See what is installed:",
    `  ${app} configure status`,
    "",
    "Uninstall:",
    `  ${app} configure uninstall`,
    `  brew uninstall <tap>/${app}`,
    ""
  ];
  if (program.appConfig && Object.keys(program.appConfig.entries).length > 0) {
    lines.push("Set configuration values:", `  ${app} configure set <key> <value>`, "");
  }
  lines.push("Use `configure status --json` for machine-readable output.");
  return lines.join(`
`);
}

// ../bun-argsbarg/src/builtins/configure.ts
var YES_OPTION = {
  name: "yes",
  description: "Skip uninstall confirmation.",
  kind: "presence" /* Presence */,
  shortName: "y"
};
var JSON_OPTION2 = {
  name: "json",
  description: "Print status JSON on stdout.",
  kind: "presence" /* Presence */
};
function isConfigureConfigPath(path) {
  return path.length >= 2 && (path[1] === "get" || path[1] === "set");
}
function configureInstallLeaf(program) {
  return {
    key: "install",
    description: "Install agent artifacts and bootstrap app config.",
    handler: async () => {
      await cliConfigureInstall(program);
    }
  };
}
function configureUninstallLeaf(program) {
  return {
    key: "uninstall",
    description: "Remove agent artifacts and app config.",
    options: [YES_OPTION],
    handler: async (ctx) => {
      await cliConfigureUninstall(program, { yes: ctx.hasFlag("yes") });
    }
  };
}
function configureStatusLeaf(program) {
  return {
    key: "status",
    description: "Print what is currently installed (read-only).",
    options: [JSON_OPTION2],
    handler: (ctx) => {
      cliConfigureStatus(program, { json: ctx.hasFlag("json") });
    }
  };
}
function cliBuiltinConfigureCommand(root) {
  const caps = resolveCapabilities(root);
  const commands = [configureInstallLeaf(root), configureUninstallLeaf(root), configureStatusLeaf(root)];
  if (configCommandsEnabled(root)) {
    commands.push(...configureConfigSubcommands(root, configMcpSetEnabled(root)));
  }
  return {
    key: "configure",
    description: configureCommandDescription(root, caps),
    notes: configureCommandNotes(root, caps),
    commands
  };
}

// ../bun-argsbarg/src/builtins/http.ts
var HTTP_SERVE_OPTIONS = [
  { name: "host", description: "Listen host.", kind: "string" /* String */ },
  { name: "port", description: "Listen port.", kind: "number" /* Number */ },
  { name: "trust-proxy", description: "Honor X-Forwarded-For for client IP.", kind: "presence" /* Presence */ },
  { name: "obscure-errors", description: "Hide unexpected errors from clients.", kind: "presence" /* Presence */ },
  {
    name: "log-format",
    description: "Log format: json (ECS Logging) or text.",
    kind: "enum" /* Enum */,
    choices: ["json", "text"]
  },
  {
    name: "log-file",
    description: "Append logs to this file (relative → app config dir).",
    kind: "string" /* String */
  },
  { name: "no-access-log", description: "Disable HTTP access logs.", kind: "presence" /* Presence */ },
  { name: "dev", description: "Print full stacks to stderr on errors.", kind: "presence" /* Presence */ }
];
function cliBuiltinHttpCommand(program) {
  const caps = resolveCapabilities(program);
  const { hostname, port } = resolveHttpListenAddress(program);
  const userGlob = httpUserPathGlob(resolveHttpPathPrefix(program));
  const lines = [
    `HTTP tool server on http://${hostname}:${port}.`,
    "",
    `Endpoints: GET /health/liveness, GET /health/readiness, GET /openapi.json, GET /swagger, ${userGlob}`,
    ""
  ];
  if (caps.configure) {
    lines.push("Configure app settings:", "", "  {argsbarg:program} configure", "");
  }
  if (docsEnabled(program)) {
    lines.push("Full setup guide: {argsbarg:program} docs http");
  }
  const serve = {
    key: "serve",
    cli: { hidden: true },
    description: "Run as an HTTP API server for tools.",
    handler: () => {}
  };
  return {
    key: "http",
    description: "HTTP API server for tools.",
    notes: lines.join(`
`),
    options: [...HTTP_SERVE_OPTIONS],
    fallbackCommand: "serve",
    fallbackMode: "missingOnly" /* MissingOnly */,
    commands: [serve]
  };
}

// ../bun-argsbarg/src/builtins/mcp.ts
var MCP_SERVE_OPTIONS = [
  { name: "obscure-errors", description: "Hide unexpected errors from clients.", kind: "presence" /* Presence */ },
  {
    name: "log-format",
    description: "Log format: json (ECS Logging) or text.",
    kind: "enum" /* Enum */,
    choices: ["json", "text"]
  },
  {
    name: "log-file",
    description: "Append logs to this file (relative → app config dir).",
    kind: "string" /* String */
  },
  { name: "dev", description: "Print full stacks to stderr on errors.", kind: "presence" /* Presence */ }
];
function cliBuiltinMcpCommand(program) {
  const caps = resolveCapabilities(program);
  const lines = [
    "Stdio MCP server. Add to Cursor, Claude Code, or Claude Desktop:",
    "",
    "  command: {argsbarg:program}",
    "  args: mcp",
    ""
  ];
  if (caps.configure) {
    lines.push("Or:", "", "  {argsbarg:program} configure", "");
  }
  if (docsEnabled(program)) {
    lines.push("Full setup guide: {argsbarg:program} docs mcp");
  }
  const serve = {
    key: "serve",
    cli: { hidden: true },
    description: "Run as an MCP server over stdio for AI agents.",
    handler: () => {}
  };
  const bundle = {
    key: "bundle",
    description: "Pack dist MCP artifacts (`.mcpb`, Claude Code plugin zip, Cursor plugin zip) from dist/<key>.",
    handler: () => {}
  };
  return {
    key: "mcp",
    description: "MCP server and bundle tools.",
    notes: lines.join(`
`),
    options: [...MCP_SERVE_OPTIONS],
    fallbackCommand: "serve",
    fallbackMode: "missingOnly" /* MissingOnly */,
    commands: [serve, bundle]
  };
}

// ../bun-argsbarg/src/builtins/version.ts
function cliBuiltinVersionCommand() {
  return {
    key: "version",
    description: "Print the program version.",
    handler: () => {}
  };
}

// ../bun-argsbarg/src/builtins/registry.ts
function pushBuiltin(builtins, program, factory) {
  if (!factory) {
    return;
  }
  const node = factory(program);
  if (node) {
    builtins.push(node);
  }
}
function resolveBuiltins(program, caps) {
  const builtins = [];
  if (caps.completion) {
    pushBuiltin(builtins, program, (p) => cliBuiltinCompletionGroup(p));
  }
  pushBuiltin(builtins, program, () => cliBuiltinVersionCommand());
  if (caps.configure) {
    pushBuiltin(builtins, program, (p) => cliBuiltinConfigureCommand(p));
  }
  pushBuiltin(builtins, program, (p) => cliBuiltinDocsGroupIfEnabled(p) ?? null);
  if (caps.mcp) {
    pushBuiltin(builtins, program, (p) => cliBuiltinMcpCommand(p));
  }
  if (caps.http) {
    pushBuiltin(builtins, program, (p) => cliBuiltinHttpCommand(p));
  }
  return builtins;
}

// ../bun-argsbarg/src/builtins/export.ts
function exportBuiltinNode(cmd) {
  if (isCliSchemaHidden(cmd)) {
    return null;
  }
  const out = {
    key: cmd.key,
    description: cmd.description
  };
  if ((cmd.notes ?? "").length > 0) {
    out.notes = cmd.notes;
  }
  const options = visibleOptions(cmd.options);
  if (options.length > 0) {
    out.options = options;
  }
  if (isCliRouter(cmd)) {
    if (cmd.fallbackCommand !== undefined) {
      out.fallbackCommand = cmd.fallbackCommand;
    }
    if (cmd.fallbackMode !== undefined) {
      out.fallbackMode = cmd.fallbackMode;
    }
    const children = cmd.commands.map((ch) => exportBuiltinNode(ch)).filter((ch) => ch !== null);
    if (children.length > 0) {
      out.commands = children;
    }
  }
  return out;
}
function exportPresentationBuiltins(program) {
  const caps = resolveCapabilities(program);
  return resolveBuiltins(program, caps).map((cmd) => exportBuiltinNode(cmd)).filter((node) => node !== null);
}

// ../bun-argsbarg/src/core/schema.ts
var RESERVED = new Set(["http", "completion", "configure", "docs", "mcp", "version"]);
function exportCommand(cmd, root) {
  if (isCliSchemaHidden(cmd)) {
    return null;
  }
  const out = {
    key: cmd.key,
    description: cmd.description
  };
  if ((cmd.notes ?? "").length > 0) {
    out.notes = cmd.notes;
  }
  const options = visibleOptions(cmd.options);
  if (options.length > 0) {
    out.options = options;
  }
  if (isCliLeaf(cmd)) {
    if ((cmd.positionals ?? []).length > 0) {
      out.positionals = cmd.positionals;
    }
    out.inputSchema = buildLeafInputSchema(cmd);
    const outputSchema = leafOutputSchema(cmd);
    if (outputSchema !== undefined) {
      out.outputSchema = outputSchema;
    } else if (cmd.http?.successContentType !== undefined) {
      out.outputContentType = cmd.http.successContentType;
    }
    out.commands = exportPresentationBuiltins(root);
    return out;
  }
  if (cmd.fallbackCommand !== undefined) {
    out.fallbackCommand = cmd.fallbackCommand;
  }
  if (cmd.fallbackMode !== undefined) {
    out.fallbackMode = cmd.fallbackMode;
  }
  const children = isCliRouter(cmd) ? cmd.commands.filter((ch) => !RESERVED.has(ch.key)) : [];
  if (children.length > 0) {
    out.commands = children.map((ch) => exportCommand(ch, root)).filter((ch) => ch !== null);
  }
  return out;
}
function resolveSchemaNotes(node, appKey) {
  const out = { ...node };
  if ((out.notes ?? "").length > 0 && out.notes !== undefined) {
    out.notes = cliResolveNotes(out.notes, appKey);
  }
  if (out.commands) {
    out.commands = out.commands.map((ch) => resolveSchemaNotes(ch, appKey));
  }
  return out;
}
function cliSchemaExport(root) {
  const exported = exportCommand(root, root);
  const errorSchema = root.httpServer?.errors?.errorSchema ?? root.mcpServer?.errors?.errorSchema;
  const base = !exported ? {
    key: root.key,
    description: root.description,
    commands: exportPresentationBuiltins(root)
  } : resolveSchemaNotes(exported, root.key);
  if (errorSchema !== undefined) {
    base.errorSchema = errorSchema;
  }
  return base;
}
function cliSchemaJson(root) {
  return `${JSON.stringify(cliSchemaExport(root), null, 2)}
`;
}

// ../bun-argsbarg/src/mcp/tools.ts
function defaultMcpSchemaUri(mcpId) {
  return `${mcpId}://schema`;
}
function sanitizeToolSegment(key) {
  return key.replace(/[^a-zA-Z0-9]/g, "_");
}
function mcpServerId(root) {
  return sanitizeToolSegment(root.key);
}
function mcpToolDescription(path, rootKey, description) {
  const prefix = path.length > 0 ? path.join(" ") : rootKey;
  return `${prefix} — ${description}`;
}
function mcpToolName(root, path) {
  if (path.length === 0) {
    return sanitizeToolSegment(root.key);
  }
  return path.map(sanitizeToolSegment).join("_");
}
function leafHasYesOption(leaf) {
  return visibleOptions(leaf.options).some((opt) => opt.name === "yes" && opt.kind === "presence" /* Presence */);
}
function formatMcpOptionValue(opt, val) {
  if (opt.format === "comma-list" /* CommaList */) {
    if (Array.isArray(val)) {
      const items = val.map(String).filter(Boolean);
      if (items.length === 0) {
        return { error: `Option --${opt.name} requires at least one value` };
      }
      return items.join(",");
    }
    if (typeof val === "string") {
      return val;
    }
    return { error: `Option --${opt.name} must be a string or array of strings` };
  }
  return String(val);
}
function resolveToolDescription(root, path, leaf) {
  let desc;
  if (leaf.mcpTool?.description) {
    desc = leaf.mcpTool.description;
  } else {
    desc = mcpToolDescription(path, root.key, leaf.description);
  }
  const notes = (leaf.notes ?? "").trim();
  if (notes.length > 0) {
    desc += `

${cliResolveNotes(notes, root.key)}`;
  }
  return desc;
}
function allMcpResources(root) {
  const schemaUri = resolveMcpSchemaUri(root);
  const builtIn = {
    uri: schemaUri,
    name: "cli-schema",
    description: "Full CLI command tree (same as docs cli-schema).",
    mimeType: "application/json",
    load: () => cliSchemaJson(root)
  };
  const user = (root.mcpServer?.resources ?? []).map((r) => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType ?? "text/plain",
    load: r.load
  }));
  return [builtIn, ...docsMcpResources(root), ...user];
}
function collectMcpTools(root) {
  const out = [];
  function walk2(cmd, path) {
    if (isCliLeaf(cmd)) {
      if (cmd.key === "completion" || cmd.key === "configure" || cmd.key === "mcp" || cmd.key === "version") {
        return;
      }
      if (isMcpHidden(cmd)) {
        return;
      }
      const outputSchema = leafOutputSchema(cmd);
      out.push({
        name: mcpToolName(root, path),
        description: resolveToolDescription(root, path, cmd),
        path,
        leaf: cmd,
        inputSchema: buildLeafInputSchema(cmd),
        ...outputSchema === undefined ? {} : { outputSchema }
      });
      return;
    }
    for (const ch of cmd.commands) {
      walk2(ch, [...path, ch.key]);
    }
  }
  if (isCliLeaf(root)) {
    walk2(root, []);
  } else {
    for (const ch of root.commands) {
      walk2(ch, [ch.key]);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function resolveMcpServerInfo(root) {
  return {
    name: mcpServerId(root),
    version: root.version
  };
}
function resolveMcpSchemaUri(root) {
  if (root.mcpServer?.schemaResourceUri) {
    return root.mcpServer.schemaResourceUri;
  }
  return defaultMcpSchemaUri(mcpServerId(root));
}
function mcpToolCallToArgv(_root, tool, args) {
  if (isDocumentLeaf(tool.leaf)) {
    return [...tool.path];
  }
  const argv = [...tool.path];
  for (const opt of leafWireOptions(tool.leaf)) {
    if (opt.kind === "json" /* Json */) {
      continue;
    }
    const val = args[opt.name];
    if (val === undefined) {
      continue;
    }
    if (opt.kind === "presence" /* Presence */) {
      if (val === true) {
        argv.push(`--${opt.name}`);
      }
      continue;
    }
    const formatted = formatMcpOptionValue(opt, val);
    if (typeof formatted !== "string") {
      return formatted;
    }
    argv.push(`--${opt.name}`, formatted);
  }
  if (leafHasYesOption(tool.leaf) && !argv.includes("--yes")) {
    argv.push("--yes");
  }
  for (const p of tool.leaf.positionals ?? []) {
    const val = args[p.name];
    const { argMin = 1, argMax = 1 } = p;
    if (argMax === 0) {
      const raw = args[p.name];
      if (raw === undefined) {
        if (argMin >= 1) {
          return { error: `Missing argument: ${p.name} (use a JSON array)` };
        }
        continue;
      }
      if (!Array.isArray(raw)) {
        return {
          error: `Argument ${p.name} must be a JSON array of strings (not a comma-separated string)`
        };
      }
      const items = raw.map(String).filter(Boolean);
      if (items.length === 0 && argMin >= 1) {
        return { error: `Missing argument: ${p.name}` };
      }
      argv.push(...items);
      continue;
    }
    if (val === undefined) {
      if (argMin >= 1) {
        return { error: `Missing argument: ${p.name}` };
      }
      continue;
    }
    argv.push(String(val));
  }
  return argv;
}

// ../bun-argsbarg/src/config/file.ts
function resolveAppConfigPath(program) {
  const dirName = sanitizeToolSegment(program.key);
  return join5(appConfigLibHome(), dirName, "config.json");
}
function resolveAppConfigDir(program) {
  return dirname5(resolveAppConfigPath(program));
}
function displayAppConfigPath(program) {
  return displayHomePath(resolveAppConfigPath(program));
}
function parseConfigJson(text, path) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("root must be a JSON object");
    }
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in config file ${displayHomePath(path)}: ${msg}`);
  }
}
function readAppConfigFileRaw(path) {
  if (!existsSync6(path)) {
    return {};
  }
  let text;
  try {
    text = readFileSync2(path, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read config file ${displayHomePath(path)}: ${msg}`);
  }
  return parseConfigJson(text, path);
}
function isEmptyConfigDocument(data) {
  return Object.keys(data).every((k) => isFrameworkConfigKey(k));
}
function appConfigFileExists(program) {
  return existsSync6(resolveAppConfigPath(program));
}
function validateAppConfigData(program, data, pathLabel, opts = {}) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    throw new Error("program.appConfig is not set");
  }
  const where = pathLabel ? displayHomePath(pathLabel) : "config";
  const bindingErrors = validateBindingsShape(data);
  if (bindingErrors.length > 0) {
    throw new Error(`Invalid config in ${where}: ${bindingErrors.join("; ")}`);
  }
  const allowed = new Set(Object.keys(appConfig.entries));
  for (const key of Object.keys(data)) {
    if (isFrameworkConfigKey(key))
      continue;
    if (!allowed.has(key)) {
      throw new Error(`Unknown config key '${key}' in ${where}`);
    }
  }
  const jsonSchema = effectiveJsonSchema(program);
  if (!jsonSchema) {
    return;
  }
  if (opts.partial || isEmptyConfigDocument(data)) {
    const result2 = validateConfigDocumentPartial(data, jsonSchema);
    if (!result2.valid) {
      throw new Error(`Invalid config in ${where}: ${result2.errors.join("; ")}`);
    }
    return;
  }
  const result = validateConfigDocument(data, jsonSchema);
  if (!result.valid) {
    throw new Error(`Invalid config in ${where}: ${result.errors.join("; ")}`);
  }
}
function writeAppConfigFileRaw(program, data, dry = false) {
  const path = resolveAppConfigPath(program);
  if (dry)
    return;
  mkdirSync4(dirname5(path), { recursive: true });
  writeFileSync3(path, `${JSON.stringify(data, null, 2)}
`, { mode: 384 });
}
function ensureAppConfigFile(program, dry = false) {
  const path = resolveAppConfigPath(program);
  if (existsSync6(path)) {
    return null;
  }
  writeAppConfigFileRaw(program, {}, dry);
  return path;
}
function readAppConfigFile(program) {
  const path = resolveAppConfigPath(program);
  const data = readAppConfigFileRaw(path);
  if (isEmptyConfigDocument(data)) {
    return data;
  }
  validateAppConfigData(program, data, path);
  return data;
}
function writeAppConfigFile(program, data, opts = {}) {
  validateAppConfigData(program, data, displayAppConfigPath(program), opts);
  writeAppConfigFileRaw(program, data);
}
function appConfigInstalled(program) {
  return appConfigFileExists(program);
}
function uninstallAppConfig(program, dry) {
  const path = resolveAppConfigPath(program);
  const dir = resolveAppConfigDir(program);
  const hasFile = existsSync6(path);
  const hasDir = existsSync6(dir);
  if (!hasFile && !hasDir) {
    return [];
  }
  const changed = [];
  if (hasFile)
    changed.push(path);
  if (hasDir)
    changed.push(`${dir}/`);
  if (!dry) {
    if (hasFile)
      unlinkSync(path);
    if (hasDir)
      rmSync2(dir, { recursive: true, force: true });
    process.stdout.write(`Removed app config ${displayAppConfigPath(program)}
`);
  }
  return changed;
}
// ../bun-argsbarg/src/config/context.ts
function rebuildResolved(program, fileData) {
  const hostEnv = captureMappedHostEnv(program);
  const resolved = resolveAppConfig(program, fileData, hostEnv);
  exportConfigToEnv(program, resolved, hostEnv);
  return resolved;
}

class EmptyAppConfigSnapshot {
  program;
  fileData;
  constructor(program, fileData) {
    this.program = program;
    this.fileData = fileData ?? readAppConfigFileRaw(resolveAppConfigPath(program));
  }
  get(_key) {
    return;
  }
  require(key) {
    throw new Error(`Configuration key '${key}' is not available (program.appConfig is not set)`);
  }
  set(_key, _value) {
    throw new Error("program.appConfig is not set");
  }
  read() {
    return {};
  }
  readUnsafe() {
    return { ...this.fileData };
  }
  getUnsafe(key) {
    return this.fileData[key];
  }
  setUnsafe(key, value) {
    const next = { ...this.fileData, [key]: value };
    writeAppConfigFileRaw(this.program, next);
    this.fileData = next;
  }
  get path() {
    return resolveAppConfigPath(this.program);
  }
  get dir() {
    return resolveAppConfigDir(this.program);
  }
}

class AppConfigSnapshot {
  program;
  snapshot;
  fileData;
  constructor(program, fileData, resolved) {
    this.program = program;
    this.fileData = { ...fileData };
    this.snapshot = { ...resolved };
  }
  get(key) {
    this.assertEntryKey(key);
    return this.snapshot[key];
  }
  require(key) {
    const value = this.get(key);
    if (value === undefined || value === null || typeof value === "string" && value.length === 0) {
      throw new Error(`Missing required configuration: ${key}`);
    }
    return value;
  }
  set(key, value) {
    this.assertEntryKey(key);
    const jsonSchema = effectiveJsonSchema(this.program);
    if (!jsonSchema) {
      throw new Error("Internal error: missing effective jsonSchema.");
    }
    const propSchema = configPropertySchema(jsonSchema, key);
    validateParsedConfigValue(value, propSchema, jsonSchema);
    const next = setBinding({ ...this.fileData, [key]: value }, key, "file");
    this.persistFileData(next);
  }
  read() {
    return { ...this.snapshot };
  }
  readUnsafe() {
    return { ...this.fileData };
  }
  getUnsafe(key) {
    return this.fileData[key];
  }
  setUnsafe(key, value) {
    this.assertUnsafeKey(key);
    const next = { ...this.fileData, [key]: value };
    this.persistFileData(next);
  }
  get path() {
    return resolveAppConfigPath(this.program);
  }
  get dir() {
    return resolveAppConfigDir(this.program);
  }
  refresh(fileData, resolved) {
    this.fileData = { ...fileData };
    this.snapshot = { ...resolved };
  }
  persistFileData(next) {
    writeAppConfigFile(this.program, next, { partial: true });
    this.fileData = next;
    this.snapshot = rebuildResolved(this.program, next);
  }
  assertEntryKey(key) {
    const entries = this.program.appConfig?.entries;
    if (!entries || !(key in entries)) {
      throw new Error(`Unknown configuration key: ${key}`);
    }
  }
  assertUnsafeKey(key) {
    if (isFrameworkConfigKey(key))
      return;
    this.assertEntryKey(key);
  }
}
function createAppConfigSnapshot(program, fileData, resolved) {
  if (!program.appConfig) {
    return new EmptyAppConfigSnapshot(program, fileData);
  }
  return new AppConfigSnapshot(program, fileData, resolved);
}

// ../bun-argsbarg/src/core/context.ts
class CliContext {
  appName;
  commandPath;
  args;
  program;
  opts;
  invocation;
  appConfig;
  toolArgs;
  pathParams;
  preloadedJson;
  locals;
  runtime;
  response;
  leafInputsCache;
  constructor(appName, commandPath2, args, opts, program, invocation = "cli", appConfig = new EmptyAppConfigSnapshot(program), toolArgs, preloadedJson = {}, pathParams = {}, locals = {}, runtime) {
    this.appName = appName;
    this.commandPath = commandPath2;
    this.args = args;
    this.opts = opts;
    this.program = program;
    this.invocation = invocation;
    this.appConfig = appConfig;
    this.toolArgs = toolArgs;
    this.preloadedJson = preloadedJson;
    this.pathParams = pathParams;
    this.locals = locals;
    this.runtime = runtime;
  }
  respond(opts) {
    if (this.response !== undefined) {
      throw new Error("ctx.respond() was already called for this invocation");
    }
    const normalized = normalizeRespondOptions(opts);
    if (this.invocation === "cli") {
      writeRespondBodyToStdout(normalized.body);
      return;
    }
    this.response = normalized;
  }
  getResponse() {
    return this.response;
  }
  hasFlag(name) {
    return this.opts[name] !== undefined;
  }
  stringOpt(name) {
    return this.opts[name];
  }
  numberOpt(name) {
    const s = this.opts[name];
    if (s === undefined)
      return null;
    return strictParseDouble(s);
  }
  typedOpt(name, parse2) {
    const s = this.opts[name];
    if (s === undefined)
      return null;
    try {
      return parse2(s);
    } catch {
      return null;
    }
  }
  durationOpt(name) {
    const s = this.opts[name];
    if (s === undefined)
      return;
    return parseDurationMs(s);
  }
  commaListOpt(name) {
    const s = this.opts[name];
    if (s === undefined)
      return;
    return parseCommaList(s);
  }
  dateOpt(name) {
    const s = this.opts[name];
    if (s === undefined)
      return;
    return parseDate(s);
  }
  dateTimeOpt(name) {
    const s = this.opts[name];
    if (s === undefined)
      return;
    return parseDateTime(s);
  }
  jsonOpt(name) {
    return readJsonOptionValue(this, name);
  }
  positional(name) {
    return this._positionalMap()[name];
  }
  get inputs() {
    if (this.leafInputsCache !== undefined) {
      return this.leafInputsCache;
    }
    this.leafInputsCache = loadLeafInputs(this);
    return this.leafInputsCache;
  }
  inputsAs() {
    return this.inputs;
  }
  _leafNode() {
    let node = this.program;
    for (const seg of this.commandPath) {
      if (!isCliRouter(node))
        return;
      const child = node.commands.find((c) => c.key === seg);
      if (!child)
        return;
      node = child;
    }
    return isCliLeaf(node) ? node : undefined;
  }
  _posMap;
  _positionalMap() {
    if (this._posMap)
      return this._posMap;
    const leaf = this._leafNode();
    if (!leaf) {
      this._posMap = {};
      return {};
    }
    const map = {};
    let argIdx = 0;
    for (const p of leaf.positionals ?? []) {
      const { argMax = 1 } = p;
      if (argMax === 0) {
        map[p.name] = this.args.slice(argIdx);
        argIdx = this.args.length;
      } else {
        const val = this.args[argIdx];
        if (val !== undefined)
          map[p.name] = val;
        argIdx++;
      }
    }
    this._posMap = map;
    return map;
  }
}
// ../bun-argsbarg/src/mcp/bundle.ts
import { cpSync as cpSync4, existsSync as existsSync10, mkdirSync as mkdirSync8, mkdtempSync as mkdtempSync3, readFileSync as readFileSync4, rmSync as rmSync5, writeFileSync as writeFileSync7 } from "node:fs";
import { tmpdir as tmpdir3 } from "node:os";
import { basename as basename3, join as join9, resolve as resolve4 } from "node:path";

// ../bun-argsbarg/src/config/manifest.ts
function buildConfigUserConfigEntry(key, entry, jsonSchemaRequired) {
  return {
    type: "string",
    title: entry.title ?? defaultConfigEntryTitle(key),
    description: entry.description,
    sensitive: configEntrySensitive(key, entry),
    required: configEntryRequired(key, entry, jsonSchemaRequired)
  };
}
function buildProgramUserConfig(program) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    return;
  }
  const jsonSchema = effectiveJsonSchema(program);
  const fromSchema = jsonSchema ? jsonSchemaRequiredKeys(jsonSchema) : undefined;
  const out = {};
  for (const [key, entry] of Object.entries(appConfig.entries)) {
    if (!entry.env) {
      continue;
    }
    out[configUserConfigKey(key)] = buildConfigUserConfigEntry(key, entry, fromSchema);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
function buildPluginMcpEnvMapping(program) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    return;
  }
  const out = {};
  for (const [key, entry] of Object.entries(appConfig.entries)) {
    if (!entry.env) {
      continue;
    }
    const manifestKey = configUserConfigKey(key);
    out[entry.env] = `\${user_config.${manifestKey}}`;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
function buildCursorPluginMcpEnvMapping(program) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    return;
  }
  const out = {};
  for (const entry of Object.values(appConfig.entries)) {
    if (!entry.env) {
      continue;
    }
    out[entry.env] = `\${${entry.env}}`;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
function buildCursorPluginVariables(program) {
  const appConfig = program.appConfig;
  if (!appConfig) {
    return;
  }
  const properties = {};
  const required = [];
  for (const entry of Object.values(appConfig.entries)) {
    if (!entry.env) {
      continue;
    }
    properties[entry.env] = {
      type: "string",
      ...entry.description ? { description: entry.description } : {}
    };
    if (entry.required) {
      required.push(entry.env);
    }
  }
  if (Object.keys(properties).length === 0) {
    return;
  }
  return {
    type: "object",
    properties,
    ...required.length > 0 ? { required } : {}
  };
}

// ../bun-argsbarg/src/mcp/claude.ts
import { cpSync as cpSync2, existsSync as existsSync8, mkdirSync as mkdirSync6, mkdtempSync, rmSync as rmSync3, writeFileSync as writeFileSync5 } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join as join7, resolve as resolve2 } from "node:path";

// ../bun-argsbarg/src/mcp/plugin-shared.ts
import {
  cpSync,
  existsSync as existsSync7,
  mkdirSync as mkdirSync5,
  readdirSync,
  readFileSync as readFileSync3,
  statSync,
  writeFileSync as writeFileSync4
} from "node:fs";
import { join as join6, relative, resolve } from "node:path";

// ../bun-argsbarg/src/skill/generate.ts
function truncate(text, maxLen) {
  if (text.length <= maxLen)
    return text;
  return `${text.slice(0, maxLen - 1)}…`;
}
function pluginSkillDescription(root) {
  const tools = collectMcpTools(root);
  const paths = tools.map((t) => t.path.length > 0 ? t.path.join(" ") : root.key);
  const sample = paths.slice(0, 5).join(", ");
  const more = paths.length > 5 ? `, and ${paths.length - 5} more` : "";
  const desc = `Use the ${root.key} MCP toolset (${sample}${more}). Use when the user mentions ${root.key}${paths.length > 0 ? `, ${paths.slice(0, 3).join(", ")}` : ""}, or related tasks.`;
  return truncate(desc, 1024);
}
function buildConfigurationSection(root) {
  if (!root.appConfig || Object.keys(root.appConfig.entries).length === 0) {
    return [];
  }
  const entries = root.appConfig.entries;
  const lines = ["## Configuration", ""];
  for (const name of Object.keys(entries).sort()) {
    const entry = entries[name];
    if (!entry)
      continue;
    const title = defaultConfigEntryTitle(name);
    const envStr = entry.env ? ` (env: \`${entry.env}\`)` : "";
    const desc = entry.description ? ` — ${entry.description}` : "";
    lines.push(`- **${name}** (\`${title}\`${envStr})${desc}`);
  }
  lines.push("");
  return lines;
}
function buildPluginSkillMd(root, dirName) {
  const lines = [
    "---",
    `name: ${dirName}`,
    `description: ${pluginSkillDescription(root)}`,
    "---",
    "",
    `# ${root.key}`,
    "",
    root.description,
    "",
    "## MCP Tools",
    "",
    `Server id: \`${mcpServerId(root)}\``,
    "",
    "Prefer using MCP tools over terminal commands when available.",
    "",
    `- Run \`tools/list\` against \`${mcpServerId(root)}\` to discover tools.`,
    `- Read schema resource \`${resolveMcpSchemaUri(root)}\` for types.`,
    ""
  ];
  const tools = collectMcpTools(root);
  if (tools.length > 0) {
    lines.push("### Available tools", "");
    for (const tool of tools) {
      const toolName = sanitizeToolSegment(tool.path.join("_"));
      const desc = tool.leaf.description;
      const wire = leafWireOptions(tool.leaf);
      const flags = wire.length > 0 ? ` (flags: ${wire.map((o) => `--${o.name}`).join(", ")})` : "";
      lines.push(`- \`${toolName}\` — ${desc}${flags}`);
    }
    lines.push("");
  }
  lines.push(...buildConfigurationSection(root));
  lines.push("## Claude Code plugin", "", `Invoke with \`/${dirName}\` or let Claude auto-match from the description.`, "");
  return lines.join(`
`);
}
function generatePluginSkillBundle(root) {
  const dirName = sanitizeToolSegment(root.key);
  return {
    dirName,
    skillMd: buildPluginSkillMd(root, dirName)
  };
}

// ../bun-argsbarg/src/mcp/plugin-shared.ts
function collectZipEntries(rootDir, dir = rootDir) {
  const entries = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join6(dir, ent.name);
    if (ent.isDirectory()) {
      entries.push(...collectZipEntries(rootDir, full));
      continue;
    }
    if (!ent.isFile()) {
      continue;
    }
    const rel = relative(rootDir, full).split("\\").join("/");
    const stMode = statSync(full).mode;
    const entry = { name: rel, data: readFileSync3(full) };
    if (stMode & 73) {
      entry.unixMode = stMode;
    }
    entries.push(entry);
  }
  return entries;
}
function defaultAuthor(bundle) {
  return bundle?.author ?? { name: "Unknown" };
}
function pluginName(program) {
  return program.key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}
function stagePluginSkills(pluginRoot, program, cwd) {
  const dirName = sanitizeToolSegment(program.key);
  const repoSkillDir = program.mcpServer?.bundle?.skillsDir ? resolve(cwd, program.mcpServer.bundle.skillsDir) : join6(cwd, "skills", dirName);
  if (existsSync7(repoSkillDir) && statSync(repoSkillDir).isDirectory()) {
    const targetDir = join6(pluginRoot, "skills", dirName);
    mkdirSync5(join6(targetDir, ".."), { recursive: true });
    cpSync(repoSkillDir, targetDir, { recursive: true });
  } else {
    const bundle = generatePluginSkillBundle(program);
    const skillMd = applyPluginSkillHint(program, bundle.skillMd);
    mkdirSync5(join6(pluginRoot, "skills", bundle.dirName), { recursive: true });
    writeFileSync4(join6(pluginRoot, "skills", bundle.dirName, "SKILL.md"), skillMd);
  }
}

// ../bun-argsbarg/src/mcp/zip.ts
function unixUxExtraField(uid, gid) {
  const uidBuf = Buffer.alloc(4);
  uidBuf.writeUInt32LE(uid >>> 0, 0);
  const gidBuf = Buffer.alloc(4);
  gidBuf.writeUInt32LE(gid >>> 0, 0);
  const payload = Buffer.concat([Buffer.from([1, 4]), uidBuf, Buffer.from([4]), gidBuf]);
  const header = Buffer.alloc(4);
  header.writeUInt16LE(30837, 0);
  header.writeUInt16LE(payload.length, 2);
  return Buffer.concat([header, payload]);
}
function unixUpExtraField(unixMode) {
  const payload = Buffer.alloc(5);
  payload.writeUInt8(1, 0);
  payload.writeUInt32LE(unixMode >>> 0, 1);
  const header = Buffer.alloc(4);
  header.writeUInt16LE(30805, 0);
  header.writeUInt16LE(payload.length, 2);
  return Buffer.concat([header, payload]);
}
function unixExtraFields(unixMode) {
  const { uid, gid } = defaultUnixIds();
  return Buffer.concat([unixUpExtraField(unixMode), unixUxExtraField(uid, gid)]);
}
function defaultUnixIds() {
  const uid = typeof process.getuid === "function" ? process.getuid() : 501;
  const gid = typeof process.getgid === "function" ? process.getgid() : 20;
  return { uid, gid };
}
function crc32(data) {
  let crc = 4294967295;
  for (let i = 0;i < data.length; i++) {
    const byte = data[i];
    if (byte === undefined) {
      continue;
    }
    crc ^= byte;
    for (let j = 0;j < 8; j++) {
      crc = crc >>> 1 ^ (crc & 1 ? 3988292384 : 0);
    }
  }
  return (crc ^ 4294967295) >>> 0;
}
function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const unixMode = file.unixMode;
    const extra = unixMode !== undefined ? unixExtraFields(unixMode) : Buffer.alloc(0);
    const local = Buffer.alloc(30 + nameBuf.length + extra.length);
    local.writeUInt32LE(67324752, 0);
    local.writeUInt16LE(unixMode !== undefined ? 10 : 20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt32LE(nameBuf.length, 26);
    local.writeUInt16LE(extra.length, 28);
    nameBuf.copy(local, 30);
    extra.copy(local, 30 + nameBuf.length);
    const centralHdr = Buffer.alloc(46 + nameBuf.length + extra.length);
    centralHdr.writeUInt32LE(33639248, 0);
    centralHdr.writeUInt16LE(unixMode !== undefined ? 798 : 20, 4);
    centralHdr.writeUInt16LE(unixMode !== undefined ? 10 : 20, 6);
    centralHdr.writeUInt16LE(0, 8);
    centralHdr.writeUInt16LE(0, 10);
    centralHdr.writeUInt16LE(0, 12);
    centralHdr.writeUInt16LE(0, 14);
    centralHdr.writeUInt32LE(crc, 16);
    centralHdr.writeUInt32LE(file.data.length, 20);
    centralHdr.writeUInt32LE(file.data.length, 24);
    centralHdr.writeUInt32LE(nameBuf.length, 28);
    centralHdr.writeUInt16LE(extra.length, 30);
    centralHdr.writeUInt16LE(0, 32);
    centralHdr.writeUInt16LE(0, 34);
    centralHdr.writeUInt16LE(0, 36);
    if (unixMode !== undefined) {
      const externalAttr = unixMode << 16 >>> 0;
      centralHdr.writeUInt32LE(externalAttr, 38);
    } else {
      centralHdr.writeUInt32LE(0, 38);
    }
    centralHdr.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHdr, 46);
    extra.copy(centralHdr, 46 + nameBuf.length);
    parts.push(local, file.data);
    central.push(centralHdr);
    offset += local.length + file.data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(101010256, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, end]);
}

// ../bun-argsbarg/src/mcp/claude.ts
var DIST_DIR = "dist";
var CLAUDE_PLUGIN_DIR = "claude-plugin";
function defaultClaudePluginPaths(program, cwd = process.cwd()) {
  const binaryName = program.key;
  const dist = join7(cwd, DIST_DIR);
  const name = pluginName(program);
  return {
    pluginZipPath: join7(dist, CLAUDE_PLUGIN_DIR, `${name}.zip`),
    binaryPath: join7(dist, binaryName),
    binaryName
  };
}
function generatePluginManifest(program, _binaryName) {
  const bundle = program.mcpServer?.bundle;
  const manifest = {
    name: pluginName(program),
    version: program.version,
    description: program.description,
    author: defaultAuthor(bundle),
    mcpServers: ".mcp.json"
  };
  const userConfig = buildProgramUserConfig(program);
  if (userConfig) {
    manifest.userConfig = userConfig;
  }
  return manifest;
}
function generatePluginMcpJson(program, binaryName) {
  const mcp = {
    command: `\${CLAUDE_PLUGIN_ROOT}/bin/${binaryName}`,
    args: ["mcp"]
  };
  const env = buildPluginMcpEnvMapping(program);
  if (env) {
    mcp.env = env;
  }
  return {
    [mcpServerId(program)]: mcp
  };
}
function writePluginTree(pluginRoot, program, binaryPath, binaryName, cwd) {
  mkdirSync6(join7(pluginRoot, ".claude-plugin"), { recursive: true });
  mkdirSync6(join7(pluginRoot, "bin"), { recursive: true });
  writeFileSync5(join7(pluginRoot, ".claude-plugin", "plugin.json"), `${JSON.stringify(generatePluginManifest(program, binaryName), null, 2)}
`);
  writeFileSync5(join7(pluginRoot, ".mcp.json"), `${JSON.stringify(generatePluginMcpJson(program, binaryName), null, 2)}
`);
  cpSync2(binaryPath, join7(pluginRoot, "bin", binaryName), { mode: 493 });
  stagePluginSkills(pluginRoot, program, cwd);
}
function packClaudePlugin(program, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const defaults = defaultClaudePluginPaths(program, cwd);
  const mcpDefaults = defaultMcpBundlePaths(program, cwd);
  const binaryPath = resolve2(cwd, opts.binaryPath ?? mcpDefaults.binaryPath);
  const pluginZipPath = resolve2(cwd, defaults.pluginZipPath);
  const binaryName = basename(binaryPath);
  if (!existsSync8(binaryPath)) {
    throw new Error(`Binary not found: ${binaryPath}. Build with compile first (expected dist/${program.key}).`);
  }
  const staging = mkdtempSync(join7(tmpdir(), "claude-plugin-"));
  try {
    writePluginTree(staging, program, binaryPath, binaryName, cwd);
    const zip = zipStore(collectZipEntries(staging));
    mkdirSync6(join7(pluginZipPath, ".."), { recursive: true });
    writeFileSync5(pluginZipPath, zip);
    return pluginZipPath;
  } finally {
    rmSync3(staging, { recursive: true, force: true });
  }
}

// ../bun-argsbarg/src/mcp/cursor.ts
import { cpSync as cpSync3, existsSync as existsSync9, mkdirSync as mkdirSync7, mkdtempSync as mkdtempSync2, rmSync as rmSync4, writeFileSync as writeFileSync6 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { basename as basename2, join as join8, resolve as resolve3 } from "node:path";
var DIST_DIR2 = "dist";
var CURSOR_PLUGIN_DIR = "cursor-plugin";
function defaultCursorPluginPaths(program, cwd = process.cwd()) {
  const binaryName = program.key;
  const dist = join8(cwd, DIST_DIR2);
  const name = pluginName(program);
  return {
    pluginZipPath: join8(dist, CURSOR_PLUGIN_DIR, `${name}.zip`),
    binaryPath: join8(dist, binaryName),
    binaryName
  };
}
function generateCursorPluginManifest(program, _binaryName) {
  const bundle = program.mcpServer?.bundle;
  const manifest = {
    name: pluginName(program),
    version: program.version,
    description: program.description,
    author: defaultAuthor(bundle)
  };
  if (bundle?.displayName) {
    manifest.displayName = bundle.displayName;
  }
  if (bundle?.homepage) {
    manifest.homepage = bundle.homepage;
  }
  if (bundle?.repository) {
    manifest.repository = bundle.repository;
  }
  if (bundle?.license) {
    manifest.license = bundle.license;
  }
  const variables = buildCursorPluginVariables(program);
  if (variables) {
    manifest.variables = variables;
  }
  return manifest;
}
function generateCursorPluginMcpJson(program, binaryName) {
  const mcp = {
    command: `\${CURSOR_PLUGIN_ROOT}/bin/${binaryName}`,
    args: ["mcp"]
  };
  const env = buildCursorPluginMcpEnvMapping(program);
  if (env) {
    mcp.env = env;
  }
  return {
    mcpServers: {
      [mcpServerId(program)]: mcp
    }
  };
}
function writePluginTree2(pluginRoot, program, binaryPath, binaryName, cwd) {
  mkdirSync7(join8(pluginRoot, ".cursor-plugin"), { recursive: true });
  mkdirSync7(join8(pluginRoot, "bin"), { recursive: true });
  writeFileSync6(join8(pluginRoot, ".cursor-plugin", "plugin.json"), `${JSON.stringify(generateCursorPluginManifest(program, binaryName), null, 2)}
`);
  writeFileSync6(join8(pluginRoot, "mcp.json"), `${JSON.stringify(generateCursorPluginMcpJson(program, binaryName), null, 2)}
`);
  cpSync3(binaryPath, join8(pluginRoot, "bin", binaryName), { mode: 493 });
  stagePluginSkills(pluginRoot, program, cwd);
}
function packCursorPlugin(program, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const defaults = defaultCursorPluginPaths(program, cwd);
  const mcpDefaults = defaultMcpBundlePaths(program, cwd);
  const binaryPath = resolve3(cwd, opts.binaryPath ?? mcpDefaults.binaryPath);
  const pluginZipPath = resolve3(cwd, defaults.pluginZipPath);
  const binaryName = basename2(binaryPath);
  if (!existsSync9(binaryPath)) {
    throw new Error(`Binary not found: ${binaryPath}. Build with compile first (expected dist/${program.key}).`);
  }
  const staging = mkdtempSync2(join8(tmpdir2(), "cursor-plugin-"));
  try {
    writePluginTree2(staging, program, binaryPath, binaryName, cwd);
    const zip = zipStore(collectZipEntries(staging));
    mkdirSync7(join8(pluginZipPath, ".."), { recursive: true });
    writeFileSync6(pluginZipPath, zip);
    return pluginZipPath;
  } finally {
    rmSync4(staging, { recursive: true, force: true });
  }
}

// ../bun-argsbarg/src/mcp/bundle.ts
var MANIFEST_VERSION = "0.3";
var DIST_DIR3 = "dist";
function defaultMcpBundlePaths(program, cwd = process.cwd()) {
  const binaryName = program.key;
  const dist = join9(cwd, DIST_DIR3);
  return {
    binaryName,
    binaryPath: join9(dist, binaryName),
    outPath: join9(dist, `${binaryName}.mcpb`)
  };
}
function buildUserConfig(program) {
  return buildProgramUserConfig(program);
}
function defaultAuthor2(bundle) {
  return bundle?.author ?? { name: "Unknown" };
}
function generateMcpManifest(program, binaryName) {
  const bundle = program.mcpServer?.bundle;
  const tools = collectMcpTools(program).map((t) => ({
    name: t.name,
    description: t.description.split(`
`)[0] ?? t.description
  }));
  const manifest = {
    manifest_version: MANIFEST_VERSION,
    name: mcpServerId(program),
    version: program.version,
    description: program.description,
    author: defaultAuthor2(bundle),
    server: {
      type: "binary",
      entry_point: binaryName,
      mcp_config: {
        command: `\${__dirname}/${binaryName}`,
        args: ["mcp"]
      }
    },
    tools,
    tools_generated: false,
    compatibility: {
      claude_desktop: ">=0.10.0",
      platforms: ["darwin"]
    }
  };
  const longDescription = bundle?.longDescription ?? program.description;
  if (longDescription !== program.description) {
    manifest.long_description = longDescription;
  }
  const userConfig = buildUserConfig(program);
  if (userConfig) {
    manifest.user_config = userConfig;
  }
  if (bundle?.icon) {
    manifest.icon = basename3(bundle.icon);
  }
  return manifest;
}
function packMcpBundle(program, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const defaults = defaultMcpBundlePaths(program, cwd);
  const binaryPath = resolve4(cwd, opts.binaryPath ?? defaults.binaryPath);
  const outPath = resolve4(cwd, opts.outPath ?? defaults.outPath);
  const binaryName = basename3(binaryPath);
  if (!existsSync10(binaryPath)) {
    throw new Error(`Binary not found: ${binaryPath}. Build with compile first (expected dist/${program.key}).`);
  }
  const staging = mkdtempSync3(join9(tmpdir3(), "mcpb-"));
  try {
    const stagedBinary = join9(staging, binaryName);
    cpSync4(binaryPath, stagedBinary, { mode: 493 });
    const manifest = generateMcpManifest(program, binaryName);
    const files = [
      {
        name: "manifest.json",
        data: Buffer.from(`${JSON.stringify(manifest, null, 2)}
`, "utf8")
      },
      { name: binaryName, data: readFileSync4(stagedBinary) }
    ];
    const iconRel = program.mcpServer?.bundle?.icon;
    if (iconRel) {
      const iconSrc = resolve4(cwd, iconRel);
      if (!existsSync10(iconSrc)) {
        throw new Error(`Bundle icon not found: ${iconRel}`);
      }
      const iconName = basename3(iconRel);
      files.push({ name: iconName, data: readFileSync4(iconSrc) });
    }
    mkdirSync8(join9(outPath, ".."), { recursive: true });
    writeFileSync7(outPath, zipStore(files));
    return outPath;
  } finally {
    rmSync5(staging, { recursive: true, force: true });
  }
}
function runMcpBundle(program) {
  const mcp = program.mcpServer;
  if (!mcp?.mcpd && !mcp?.claudePlugin && !mcp?.cursorPlugin) {
    throw new Error("mcp bundle: enable mcpServer.mcpd, mcpServer.claudePlugin, and/or mcpServer.cursorPlugin on the program root.");
  }
  const lines = [];
  if (mcp.mcpd) {
    lines.push(packMcpBundle(program));
  }
  if (mcp.claudePlugin) {
    lines.push(packClaudePlugin(program));
  }
  if (mcp.cursorPlugin) {
    lines.push(packCursorPlugin(program));
  }
  process.stdout.write(`${lines.join(`
`)}
`);
}
// ../bun-argsbarg/src/runtime/cli.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { format as format2 } from "node:util";

// ../bun-argsbarg/src/server/overrides.ts
import { join as join10 } from "node:path";
function resolveLogFile(program, logFile) {
  if (!logFile) {
    return;
  }
  if (logFile.startsWith("/") || logFile.startsWith("~")) {
    return logFile;
  }
  return join10(resolveAppConfigDir(program), logFile);
}
function resolveHttpServeConfig(program, overrides = {}) {
  const http = program.httpServer;
  const obscureUnexpected = overrides.obscureErrors ?? http?.errors?.obscureUnexpected ?? false;
  return {
    hostname: overrides.host ?? http?.host ?? "127.0.0.1",
    port: overrides.port ?? http?.port ?? 3000,
    trustProxy: overrides.trustProxy ?? http?.trustProxy ?? false,
    obscureUnexpected,
    log: {
      format: overrides.logFormat ?? program.log?.format ?? "json",
      file: resolveLogFile(program, overrides.logFile ?? program.log?.file),
      access: overrides.noAccessLog ? false : program.log?.access ?? true,
      errors: program.log?.errors ?? true,
      dev: overrides.dev ?? false
    }
  };
}
function resolveMcpServeConfig(program, overrides = {}) {
  const mcp = program.mcpServer;
  return {
    obscureUnexpected: overrides.obscureErrors ?? mcp?.errors?.obscureUnexpected ?? false,
    log: {
      format: overrides.logFormat ?? program.log?.format ?? "json",
      file: resolveLogFile(program, overrides.logFile ?? program.log?.file),
      access: program.log?.access ?? true,
      errors: program.log?.errors ?? true,
      dev: overrides.dev ?? false
    }
  };
}
function serveOverridesFromOpts(opts, surface) {
  const out = {};
  if (opts.host) {
    out.host = opts.host;
  }
  if (opts.port) {
    const port = Number(opts.port);
    if (!Number.isNaN(port)) {
      out.port = port;
    }
  }
  if (opts["trust-proxy"]) {
    out.trustProxy = true;
  }
  if (opts["obscure-errors"]) {
    out.obscureErrors = true;
  }
  if (opts["log-format"] === "json" || opts["log-format"] === "text") {
    out.logFormat = opts["log-format"];
  }
  if (opts["log-file"]) {
    out.logFile = opts["log-file"];
  }
  if (opts["no-access-log"] && surface === "http") {
    out.noAccessLog = true;
  }
  if (opts.dev) {
    out.dev = true;
  }
  return out;
}

// ../bun-argsbarg/src/builtins/shell-helpers.ts
function identToken(s) {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}
function escShellSingleQuoted(s) {
  return s.replace(/'/g, "'\\''");
}
function escFishSingleQuoted(s) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
function mainName(schemaName) {
  return schemaName.replace(/[^a-zA-Z0-9]/g, "_");
}
var kHelpLong = "--help";
var kHelpShort = "-h";

// ../bun-argsbarg/src/builtins/completion-simulate-shared.ts
function emitConsumeLong(ident, scopes) {
  let o = "_${ident}_nac_consume_long() {\n".replace("${ident}", ident);
  o += `  local sid="$1" w="$2" nw="$3"
`;
  o += `  case $sid in
`;
  for (const [i, sc] of scopes.entries()) {
    o += `    ${i})
`;
    o += `      case $w in
`;
    o += "        " + kHelpLong + "|${kHelpLong}=*|${kHelpShort}) echo 1 ;;\n".replace(/\$\{kHelpLong\}/g, kHelpLong).replace(/\$\{kHelpShort\}/g, kHelpShort);
    for (const op of sc.opts) {
      const base = `--${op.name}`;
      if (op.kind === "presence") {
        o += `        ${base}${"|${base}=*) echo 1 ;;\n".replace(/\$\{base\}/g, base)}`;
      } else {
        o += `        ${base}=*) echo 1 ;;
`;
        o += `        ${base}) echo 2 ;;
`;
      }
    }
    o += `        *) echo 0 ;;
`;
    o += `      esac
`;
    o += `      ;;
`;
  }
  o += `    *) echo 0 ;;
`;
  o += `  esac
`;
  o += `}
`;
  return o;
}
function emitConsumeShort(ident, scopes, dialect) {
  const firstChar = dialect === "bash" ? "ch=${rest:0:1}" : "ch=${rest[1,1]}";
  const restAdvance = dialect === "bash" ? "rest=${rest:1}" : "rest=${rest[2,-1]}";
  let o = "_${ident}_nac_consume_short() {\n".replace("${ident}", ident);
  o += `  local sid="$1" w="$2"
`;
  o += `  case $sid in
`;
  for (const [i, sc] of scopes.entries()) {
    o += `    ${i})
`;
    o += "      local rest=${w#-}\n";
    o += `      local ch
`;
    o += `      local saw=0
`;
    o += `      while [[ -n $rest ]]; do
`;
    o += `        ${firstChar}
`;
    o += `        ${restAdvance}
`;
    o += `        case $ch in
`;
    let boolChars = "";
    for (const op of sc.opts) {
      if (!op.shortName)
        continue;
      if (op.kind === "presence") {
        boolChars += `${op.shortName}|`;
      } else {
        o += `          ${op.shortName})
`;
        o += `            if [[ $saw -ne 0 || -n $rest ]]; then echo 0; return; fi
`;
        o += `            echo 2; return ;;
`;
      }
    }
    if (boolChars.length > 0) {
      boolChars = boolChars.slice(0, -1);
      o += `          ${boolChars}) ;;
`;
    }
    o += `          *) echo 0; return ;;
`;
    o += `        esac
`;
    o += `        saw=1
`;
    o += `      done
`;
    o += `      echo 1
`;
    o += `      ;;
`;
  }
  o += `    *) echo 0 ;;
`;
  o += `  esac
`;
  o += `}
`;
  return o;
}
function emitMatchChild(ident, scopes, pathIndex) {
  let o = "_${ident}_nac_match_child() {\n".replace("${ident}", ident);
  o += `  local sid="$1" w="$2"
`;
  o += `  case $sid in
`;
  for (const [sid, sc] of scopes.entries()) {
    if (sc.kids.length === 0)
      continue;
    o += `    ${sid})
`;
    o += `      case $w in
`;
    for (const ch of sc.kids) {
      if (ch.key.startsWith(":")) {
        continue;
      }
      const childPath = sc.path === "" ? ch.key : `${sc.path}/${ch.key}`;
      const cid = pathIndex[childPath] ?? 0;
      o += `        ${ch.key}) echo ${cid}; return 0 ;;
`;
    }
    const paramChild = sc.kids.find((ch) => ch.key.startsWith(":"));
    if (paramChild) {
      const childPath = sc.path === "" ? paramChild.key : `${sc.path}/${paramChild.key}`;
      const cid = pathIndex[childPath] ?? 0;
      o += `        *) echo ${cid}; return 0 ;;
`;
    }
    o += `      esac
`;
    o += `      ;;
`;
  }
  o += `  esac
`;
  o += `  return 1
`;
  o += `}
`;
  return o;
}

// ../bun-argsbarg/src/builtins/scopes.ts
function hasPositionalArguments(cmd) {
  return isCliLeaf(cmd) && (cmd.positionals ?? []).length > 0;
}
function walkScopes(cmdPath, cmd, acc) {
  const kids = isCliRouter(cmd) ? cmd.commands : [];
  acc.push({
    kids,
    opts: cmd.options ?? [],
    path: cmdPath,
    wantsFiles: hasPositionalArguments(cmd)
  });
  for (const ch of kids) {
    const nextPath = cmdPath === "" ? ch.key : `${cmdPath}/${ch.key}`;
    walkScopes(nextPath, ch, acc);
  }
}
function collectScopes(schema) {
  const acc = [];
  acc.push({
    kids: schema.commands ?? [],
    opts: schema.options ?? [],
    path: "",
    wantsFiles: false
  });
  for (const c of schema.commands ?? []) {
    walkScopes(c.key, c, acc);
  }
  return acc;
}

// ../bun-argsbarg/src/builtins/completion-bash.ts
function emitSimulate(ident) {
  let o = "_${ident}_nac_simulate() {\n".replace("${ident}", ident);
  o += `  local i=1 sid=0 w steps next
`;
  o += `  while (( i < COMP_CWORD )); do
`;
  o += '    w="${COMP_WORDS[i]}"\n';
  o += `    if [[ $w == ${kHelpShort} || $w == ${kHelpLong} ]]; then
`;
  o += `      ((i++)); continue
`;
  o += `    fi
`;
  o += `    if [[ $w == --* ]]; then
`;
  o += '      steps=$(_${ident}_nac_consume_long "$sid" "$w" "${COMP_WORDS[i+1]}")\n'.replace("${ident}", ident);
  o += `      case $steps in
`;
  o += `        0) break ;;
`;
  o += `        1) ((i++)) ;;
`;
  o += `        2) ((i+=2)) ;;
`;
  o += `        *) break ;;
`;
  o += `      esac
`;
  o += `      continue
`;
  o += `    fi
`;
  o += `    if [[ $w == -* ]]; then
`;
  o += '      steps=$(_${ident}_nac_consume_short "$sid" "$w")\n'.replace("${ident}", ident);
  o += `      case $steps in
`;
  o += `        0) break ;;
`;
  o += `        1) ((i++)) ;;
`;
  o += `        2) ((i++)); break ;;
`;
  o += `        *) break ;;
`;
  o += `      esac
`;
  o += `      continue
`;
  o += `    fi
`;
  o += '    next=$(_${ident}_nac_match_child "$sid" "$w") || break\n'.replace("${ident}", ident);
  o += `    sid=$next
`;
  o += `    ((i++))
`;
  o += `  done
`;
  o += `  REPLY_SID=$sid
`;
  o += `}
`;
  return o;
}
function emitEnumReplyBash(ident, scopes) {
  let o = "_${ident}_nac_enum_reply() {\n".replace("${ident}", ident);
  o += `  local sid="$1" prev="$2" cur="$3"
`;
  o += `  case $sid in
`;
  for (const [i, sc] of scopes.entries()) {
    const enumOpts = sc.opts.filter((op) => op.kind === "enum" /* Enum */ && (op.choices?.length ?? 0) > 0);
    if (enumOpts.length === 0)
      continue;
    o += `    ${i})
`;
    o += `      case $prev in
`;
    for (const op of enumOpts) {
      const words = (op.choices ?? []).map((c) => escShellSingleQuoted(c)).join(" ");
      o += `        --${op.name}) COMPREPLY=( $(compgen -W '${words}' -- "$cur") ); return 0 ;;
`;
    }
    o += `      esac
`;
    o += `      ;;
`;
  }
  o += `  esac
`;
  o += `  return 1
`;
  o += `}
`;
  return o;
}
function emitMainBodyBash(schema, ident) {
  const main = mainName(schema.key);
  let o = "_${main}() {\n".replace("${main}", main);
  o += '  local cur="${COMP_WORDS[COMP_CWORD]}"\n';
  o += '  local prev="${COMP_WORDS[COMP_CWORD-1]:-}"\n';
  o += "  _${ident}_nac_simulate\n".replace("${ident}", ident);
  o += `  local sid=$REPLY_SID
`;
  o += '  if _${ident}_nac_enum_reply "$sid" "$prev" "$cur"; then return; fi\n'.replace("${ident}", ident);
  o += `  if [[ $cur == -* ]]; then
`;
  o += '    local oname="A_${ident}_${sid}_opts"\n'.replace("${ident}", ident);
  o += `    local -a optsarr
`;
  o += `    local -n optsref="$oname"
`;
  o += '    COMPREPLY=( $(compgen -W "${optsref[*]}" -- "$cur") )\n';
  o += `  else
`;
  o += '    local lname="A_${ident}_${sid}_leaf"\n'.replace("${ident}", ident);
  o += `    local -n leafref="$lname"
`;
  o += `    if [[ $leafref -eq 0 ]]; then
`;
  o += '      local cname="A_${ident}_${sid}_cmds"\n'.replace("${ident}", ident);
  o += `      local -a cmdsarr
`;
  o += `      local -n cmdsref="$cname"
`;
  o += '      COMPREPLY=( $(compgen -W "${cmdsref[*]}" -- "$cur") )\n';
  o += `    else
`;
  o += '      local pname="A_${ident}_${sid}_pos"\n'.replace("${ident}", ident);
  o += `      local -n posref="$pname"
`;
  o += `      if [[ $posref -eq 1 ]]; then
`;
  o += `        compopt -o filenames
`;
  o += `      fi
`;
  o += `    fi
`;
  o += `  fi
`;
  o += `}

`;
  o += "complete -F _${main} ${schema.key}\n".replace("${main}", main).replace("${schema.key}", schema.key);
  return o;
}
function completionBashScript(schema) {
  const ident = identToken(schema.key);
  const scopes = collectScopes(schema);
  const pathIndex = {};
  for (const [i, s] of scopes.entries()) {
    pathIndex[s.path] = i;
  }
  let out = `# Generated bash completion for ${schema.key}.

`;
  for (const [i, sc] of scopes.entries()) {
    out += `A_${ident}_${i}_opts=()
`;
    out += `A_${ident}_${i}_opts+=('${kHelpLong}' '${kHelpShort}')
`;
    for (const o of sc.opts) {
      out += `A_${ident}_${i}_opts+=('--${o.name}')
`;
      if (o.shortName) {
        out += `A_${ident}_${i}_opts+=('-${o.shortName}')
`;
      }
    }
    out += `A_${ident}_${i}_leaf=${sc.kids.length === 0 ? "1" : "0"}
`;
    out += `A_${ident}_${i}_pos=${sc.wantsFiles ? "1" : "0"}
`;
    if (sc.kids.length > 0) {
      out += `A_${ident}_${i}_cmds=(`;
      for (const ch of sc.kids) {
        out += ` '${ch.key}'`;
      }
      out += `)
`;
    }
  }
  out += emitConsumeLong(ident, scopes);
  out += emitConsumeShort(ident, scopes, "bash");
  out += emitMatchChild(ident, scopes, pathIndex);
  out += emitSimulate(ident);
  out += emitEnumReplyBash(ident, scopes);
  out += emitMainBodyBash(schema, ident);
  return out;
}

// ../bun-argsbarg/src/builtins/completion-fish.ts
function scopeCondition(ident, scopeIndex, path) {
  const fn = `__${ident}_scope_${scopeIndex}`;
  let body = `function ${fn}
`;
  body += `    set -l tokens (commandline -opc)
`;
  if (path === "") {
    body += `    test (count $tokens) -eq 0
`;
  } else {
    const parts = path.split("/");
    body += `    test (count $tokens) -eq ${parts.length}
`;
    for (let i = 0;i < parts.length; i++) {
      body += `    and test $tokens[${i + 1}] = ${parts[i]}
`;
    }
  }
  body += `end

`;
  return body;
}
function completionFishScript(schema) {
  const ident = identToken(schema.key);
  const app = schema.key;
  const scopes = collectScopes(schema);
  let out = `# Fish completion for ${app}

`;
  for (const [i, sc] of scopes.entries()) {
    out += scopeCondition(ident, i, sc.path);
    const cond = `__${ident}_scope_${i}`;
    for (const ch of sc.kids) {
      out += `complete -c ${app} -n '${cond}' -a '${escFishSingleQuoted(ch.key)}' -d '${escFishSingleQuoted(ch.description)}'
`;
    }
    out += `complete -c ${app} -n '${cond}' -s h -l help -d '${escFishSingleQuoted("Show help for this command.")}'
`;
    for (const op of sc.opts) {
      if (op.kind === "presence" /* Presence */) {
        const shortPart = op.shortName ? `-s ${op.shortName} ` : "";
        out += `complete -c ${app} -n '${cond}' ${shortPart}-l ${op.name} -d '${escFishSingleQuoted(op.description)}'
`;
      } else if (op.kind === "enum" /* Enum */ && (op.choices?.length ?? 0) > 0) {
        const shortPart = op.shortName ? `-s ${op.shortName} ` : "";
        out += `complete -c ${app} -n '${cond}' ${shortPart}-l ${op.name} -d '${escFishSingleQuoted(op.description)}'
`;
        const enumCond = `${cond}; and __fish_seen_argument -l ${op.name}`;
        for (const choice of op.choices ?? []) {
          out += `complete -c ${app} -n '${enumCond}' -a '${escFishSingleQuoted(choice)}'
`;
        }
      } else {
        const shortPart = op.shortName ? `-s ${op.shortName} ` : "";
        out += `complete -c ${app} -n '${cond}' ${shortPart}-l ${op.name} -d '${escFishSingleQuoted(op.description)}' -r
`;
      }
    }
    if (sc.wantsFiles && sc.kids.length === 0) {
      out += `complete -c ${app} -n '${cond}' -F
`;
    }
  }
  return out;
}

// ../bun-argsbarg/src/builtins/completion-zsh.ts
function emitScopeArraysZsh(ident, scopes) {
  let out = "";
  for (const [i, sc] of scopes.entries()) {
    out += `typeset -g A_${ident}_${i}_opts
`;
    out += `A_${ident}_${i}_opts=(`;
    out += "'" + escShellSingleQuoted(kHelpLong) + ":" + escShellSingleQuoted("Show help for this command.") + "' '" + escShellSingleQuoted(kHelpShort) + ":" + escShellSingleQuoted("Show help for this command.") + "'";
    for (const o of sc.opts) {
      out += ` '${escShellSingleQuoted(`--${o.name}`)}:${escShellSingleQuoted(o.description)}'`;
      if (o.shortName) {
        out += ` '${escShellSingleQuoted(`-${o.shortName}`)}:${escShellSingleQuoted(o.description)}'`;
      }
    }
    out += `)
`;
    out += `typeset -g A_${ident}_${i}_leaf=${sc.kids.length === 0 ? "1" : "0"}
`;
    out += `typeset -g A_${ident}_${i}_pos=${sc.wantsFiles ? "1" : "0"}
`;
    if (sc.kids.length > 0) {
      out += `typeset -g A_${ident}_${i}_cmds=(`;
      for (const ch of sc.kids) {
        out += ` '${escShellSingleQuoted(ch.key)}:${escShellSingleQuoted(ch.description)}'`;
      }
      out += `)
`;
    }
  }
  return out;
}
function emitSimulateZsh(ident) {
  let o = "_${ident}_nac_simulate() {\n".replace("${ident}", ident);
  o += `  local i=2 sid=0 w steps next
`;
  o += `  while (( i < CURRENT )); do
`;
  o += `    w=$words[i]
`;
  o += `    if [[ $w == ${kHelpShort} || $w == ${kHelpLong} ]]; then
`;
  o += `      ((i++)); continue
`;
  o += `    fi
`;
  o += `    if [[ $w == --* ]]; then
`;
  o += '      steps=$(_${ident}_nac_consume_long "$sid" "$w" "${words[i+1]}")\n'.replace("${ident}", ident);
  o += `      case $steps in
`;
  o += `        0) break ;;
`;
  o += `        1) ((i++)) ;;
`;
  o += `        2) ((i+=2)) ;;
`;
  o += `        *) break ;;
`;
  o += `      esac
`;
  o += `      continue
`;
  o += `    fi
`;
  o += `    if [[ $w == -* ]]; then
`;
  o += '      steps=$(_${ident}_nac_consume_short "$sid" "$w")\n'.replace("${ident}", ident);
  o += `      case $steps in
`;
  o += `        0) break ;;
`;
  o += `        1) ((i++)) ;;
`;
  o += `        2) ((i++)); break ;;
`;
  o += `        *) break ;;
`;
  o += `      esac
`;
  o += `      continue
`;
  o += `    fi
`;
  o += '    next=$(_${ident}_nac_match_child "$sid" "$w") || break\n'.replace("${ident}", ident);
  o += `    sid=$next
`;
  o += `    ((i++))
`;
  o += `  done
`;
  o += `  REPLY_SID=$sid
`;
  o += `}
`;
  return o;
}
function emitEnumReplyZsh(ident, scopes) {
  let o = "_${ident}_nac_enum_reply() {\n".replace("${ident}", ident);
  o += `  local sid=$1 prev=$2
`;
  o += `  case $sid in
`;
  for (const [i, sc] of scopes.entries()) {
    const enumOpts = sc.opts.filter((op) => op.kind === "enum" /* Enum */ && (op.choices?.length ?? 0) > 0);
    if (enumOpts.length === 0)
      continue;
    o += `    ${i})
`;
    o += `      case $prev in
`;
    for (const op of enumOpts) {
      const vals = (op.choices ?? []).map((c) => escShellSingleQuoted(c)).join(" ");
      o += `        --${op.name}) _values ${vals}; return 0 ;;
`;
    }
    o += `      esac
`;
    o += `      ;;
`;
  }
  o += `  esac
`;
  o += `  return 1
`;
  o += `}
`;
  return o;
}
function emitMainBodyZsh(schema, ident) {
  const main = mainName(schema.key);
  let o = "_${main}() {\n".replace("${main}", main);
  o += `  local curcontext="$curcontext" ret=1
`;
  o += "  _${ident}_nac_simulate\n".replace("${ident}", ident);
  o += `  local sid=$REPLY_SID
`;
  o += '  if _${ident}_nac_enum_reply "$sid" "$words[CURRENT-1]"; then return 0; fi\n'.replace("${ident}", ident);
  o += `  if [[ $PREFIX == -* ]]; then
`;
  o += `    local -a optsarr
`;
  o += '    local oname="A_${ident}_${sid}_opts"\n'.replace("${ident}", ident);
  o += "    optsarr=(${(@P)oname})\n";
  o += `    _describe -t options 'option' optsarr && ret=0
`;
  o += `  else
`;
  o += '    local lname="A_${ident}_${sid}_leaf"\n'.replace("${ident}", ident);
  o += "    if [[ ${(P)lname} -eq 0 ]]; then\n";
  o += `      local -a cmdsarr
`;
  o += '      local cname="A_${ident}_${sid}_cmds"\n'.replace("${ident}", ident);
  o += "      cmdsarr=(${(@P)cname})\n";
  o += `      _describe -t commands 'command' cmdsarr && ret=0
`;
  o += `    else
`;
  o += '      local pname="A_${ident}_${sid}_pos"\n'.replace("${ident}", ident);
  o += "      if [[ ${(P)pname} -eq 1 ]]; then\n";
  o += `        _files && ret=0
`;
  o += `      fi
`;
  o += `    fi
`;
  o += `  fi
`;
  o += `  return ret
`;
  o += `}

`;
  o += "compdef _${main} ${schema.key}\n".replace("${main}", main).replace("${schema.key}", schema.key);
  return o;
}
function completionZshScript(schema) {
  const ident = identToken(schema.key);
  const scopes = collectScopes(schema);
  const pathIndex = {};
  for (const [i, s] of scopes.entries()) {
    pathIndex[s.path] = i;
  }
  let out = `#compdef ${schema.key}

`;
  out += emitScopeArraysZsh(ident, scopes);
  out += emitConsumeLong(ident, scopes);
  out += emitConsumeShort(ident, scopes, "zsh");
  out += emitMatchChild(ident, scopes, pathIndex);
  out += emitSimulateZsh(ident);
  out += emitEnumReplyZsh(ident, scopes);
  out += emitMainBodyZsh(schema, ident);
  return out;
}

// ../bun-argsbarg/src/builtins/presentation.ts
function parseBuiltins(program, caps) {
  return resolveBuiltins(program, caps);
}
function presentationBuiltins(program, caps) {
  return parseBuiltins(program, caps).filter((b) => !isCliHidden(b));
}
function cliParseRoot(program) {
  const caps = resolveCapabilities(program);
  const builtins = parseBuiltins(program, caps);
  if (isCliLeaf(program)) {
    return {
      key: program.key,
      description: program.description,
      notes: program.notes,
      options: program.options,
      commands: builtins
    };
  }
  return {
    key: program.key,
    description: program.description,
    notes: program.notes,
    options: program.options,
    fallbackCommand: program.fallbackCommand,
    fallbackMode: program.fallbackMode,
    commands: [...program.commands, ...builtins]
  };
}
function cliPresentationRoot(program) {
  const caps = resolveCapabilities(program);
  const builtins = presentationBuiltins(program, caps);
  const notes = presentationRootNotes(program, caps);
  if (isCliLeaf(program)) {
    return {
      key: program.key,
      description: program.description,
      notes,
      options: visibleOptions(program.options),
      commands: builtins
    };
  }
  const userCommands = program.commands.map((ch) => presentationNode(ch)).filter((ch) => ch !== null);
  return {
    key: program.key,
    description: program.description,
    notes,
    options: visibleOptions(program.options),
    fallbackCommand: program.fallbackCommand,
    fallbackMode: program.fallbackMode,
    commands: [...userCommands, ...builtins]
  };
}
function presentationRootNotes(program, _caps) {
  const parts = [];
  if ((program.notes ?? "").trim().length > 0) {
    parts.push((program.notes ?? "").trim());
  }
  if (parts.length === 0) {
    return;
  }
  return parts.join(`

`);
}

// ../bun-argsbarg/src/builtins/dispatch.ts
function completionSchema(program, opts) {
  if (opts.isLeafCompletionIntercept) {
    return cliPresentationRoot(program);
  }
  return opts.parseRoot;
}
async function dispatchBuiltin(program, pr, opts) {
  if (pr.kind !== "ok" /* Ok */) {
    return;
  }
  const caps = resolveCapabilities(program);
  if (pr.path[0] === "completion") {
    if (!caps.completion) {
      process.stderr.write(capabilityDeniedMessage("completion"));
      process.exit(1);
    }
    const schemaForCompletion = completionSchema(program, opts);
    if (pr.path[1] === "bash") {
      process.stdout.write(completionBashScript(schemaForCompletion));
      process.exit(0);
    }
    if (pr.path[1] === "zsh") {
      process.stdout.write(completionZshScript(schemaForCompletion));
      process.exit(0);
    }
    if (pr.path[1] === "fish") {
      process.stdout.write(completionFishScript(schemaForCompletion));
      process.exit(0);
    }
    return;
  }
  if (pr.path[0] === "version") {
    if (pr.path.length !== 1) {
      process.stderr.write(`Unknown subcommand: version ${pr.path.slice(1).join(" ")}
`);
      process.exit(1);
    }
    process.stdout.write(`${program.version}
`);
    process.exit(0);
  }
  if (pr.path[0] === "http") {
    if (!caps.http) {
      process.stderr.write(capabilityDeniedMessage("http"));
      process.exit(1);
    }
    const sub = pr.path[1];
    if (pr.path.length === 1 || sub === "serve") {
      await new Cli(program).serveHttp(serveOverridesFromOpts(pr.opts, "http"));
      process.exit(0);
    }
    process.stderr.write(`Unknown subcommand: http ${pr.path.slice(1).join(" ")}
`);
    process.exit(1);
  }
  if (pr.path[0] === "mcp") {
    if (!caps.mcp) {
      process.stderr.write(capabilityDeniedMessage("mcp"));
      process.exit(1);
    }
    const sub = pr.path[1];
    if (pr.path.length === 1 || sub === "serve") {
      await new Cli(program).serveMcp(serveOverridesFromOpts(pr.opts, "mcp"));
      process.exit(0);
    }
    if (pr.path.length === 2 && sub === "bundle") {
      try {
        runMcpBundle(program);
      } catch (err) {
        process.stderr.write(err instanceof Error ? `${err.message}
` : `mcp bundle failed.
`);
        process.exit(1);
      }
      process.exit(0);
    }
    process.stderr.write(`Unknown subcommand: mcp ${pr.path.slice(1).join(" ")}
`);
    process.exit(1);
  }
  if (pr.path[0] === "configure") {
    if (!caps.configure) {
      process.stderr.write(capabilityDeniedMessage("configure"));
      process.exit(1);
    }
    if (isConfigureConfigPath(pr.path)) {
      return;
    }
  }
}
function builtinInterceptRoot(program, argv) {
  if (!isCliLeaf(program) || argv.length < 1) {
    return { parseRoot: program, isLeafCompletionIntercept: false };
  }
  const caps = resolveCapabilities(program);
  const first = argv[0];
  if (first === "completion") {
    return {
      parseRoot: {
        key: program.key,
        description: program.description,
        commands: [cliBuiltinCompletionGroup(program)]
      },
      isLeafCompletionIntercept: true
    };
  }
  if (first === "configure" && caps.configure) {
    return {
      parseRoot: {
        key: program.key,
        description: program.description,
        commands: [cliBuiltinConfigureCommand(program)]
      },
      isLeafCompletionIntercept: false
    };
  }
  if (first === "http" && caps.http) {
    return {
      parseRoot: {
        key: program.key,
        description: program.description,
        commands: [cliBuiltinHttpCommand(program)]
      },
      isLeafCompletionIntercept: false
    };
  }
  if (first === "mcp" && caps.mcp) {
    return {
      parseRoot: {
        key: program.key,
        description: program.description,
        commands: [cliBuiltinMcpCommand(program)]
      },
      isLeafCompletionIntercept: false
    };
  }
  if (first === "version") {
    return {
      parseRoot: {
        key: program.key,
        description: program.description,
        commands: [cliBuiltinVersionCommand()]
      },
      isLeafCompletionIntercept: false
    };
  }
  const docsGroup = cliBuiltinDocsGroupIfEnabled(program);
  if (first === "docs" && docsGroup) {
    return {
      parseRoot: {
        key: program.key,
        description: program.description,
        commands: [docsGroup]
      },
      isLeafCompletionIntercept: false
    };
  }
  return { parseRoot: program, isLeafCompletionIntercept: false };
}

// ../bun-argsbarg/src/core/validate.ts
function validateDocsConfig(docs) {
  const topics = docs.topics ?? {};
  const keys = Object.keys(topics);
  for (const reserved of DOCS_BUILTIN_TOPIC_KEYS) {
    if (reserved in topics) {
      throw new CliSchemaValidationError(`docs.topics key '${reserved}' is reserved for the docs built-in`);
    }
  }
  for (const key of keys) {
    const text = topics[key]?.text;
    if (text === undefined || text.length === 0) {
      throw new CliSchemaValidationError(`docs.topics['${key}'].text must be non-empty`);
    }
  }
}
function validateConfigBlock(appConfigBlock) {
  const entries = appConfigBlock.entries;
  if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
    throw new CliSchemaValidationError("program.appConfig.entries must be an object");
  }
  const envNames = new Set;
  for (const [key, entry] of Object.entries(entries)) {
    if (key.length === 0) {
      throw new CliSchemaValidationError("program.appConfig.entries keys must be non-empty strings");
    }
    if (entry === undefined || typeof entry !== "object") {
      throw new CliSchemaValidationError(`program.appConfig.entries['${key}'] must be an object`);
    }
    const description = entry.description;
    if (typeof description !== "string" || description.trim().length === 0) {
      throw new CliSchemaValidationError(`program.appConfig.entries['${key}'].description must be a non-empty string`);
    }
    if (entry.env !== undefined) {
      if (typeof entry.env !== "string" || entry.env.length === 0) {
        throw new CliSchemaValidationError(`program.appConfig.entries['${key}'].env must be a non-empty string when set`);
      }
      if (envNames.has(entry.env)) {
        throw new CliSchemaValidationError(`Duplicate program.appConfig env mapping: ${entry.env}`);
      }
      envNames.add(entry.env);
    }
    if (entry.resolve !== undefined && typeof entry.resolve !== "function") {
      throw new CliSchemaValidationError(`program.appConfig.entries['${key}'].resolve must be a function when set`);
    }
  }
  const jsonSchema = appConfigBlock.jsonSchema;
  if (jsonSchema !== undefined) {
    if (typeof jsonSchema !== "object" || jsonSchema === null || Array.isArray(jsonSchema)) {
      throw new CliSchemaValidationError("program.appConfig.jsonSchema must be a JSON Schema object (not null or an array)");
    }
    const properties = jsonSchema.properties;
    if (properties !== undefined) {
      if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
        throw new CliSchemaValidationError("program.appConfig.jsonSchema.properties must be an object when set");
      }
      for (const key of Object.keys(entries)) {
        if (!(key in properties)) {
          throw new CliSchemaValidationError(`program.appConfig.entries key '${key}' is missing from jsonSchema.properties`);
        }
      }
    }
  }
}
function validateConfigureConfig(program) {
  const configure = program.configure;
  if (!configure)
    return;
  if ("prefix" in configure) {
    throw new CliSchemaValidationError("configure.prefix removed; app binary installs via Homebrew");
  }
  if ("agentIntegration" in configure) {
    throw new CliSchemaValidationError("configure.agentIntegration removed; skills are authored under skills/<app>/SKILL.md");
  }
  if (!configure.targets)
    return;
  const targets = configure.targets;
  if ("allSkills" in targets || "allMcps" in targets) {
    throw new CliSchemaValidationError("configure.targets.allSkills/allMcps removed; use per-key targets");
  }
  const legacySkillKeys = ["cursorSkill", "claudeSkill", "codexSkill", "opencodeSkill", "openclawSkill"];
  for (const key of legacySkillKeys) {
    if (key in targets) {
      throw new CliSchemaValidationError(`configure.targets.${key} removed; skills are authored under skills/<app>/SKILL.md`);
    }
  }
  const legacyMcpKeys = [
    "cursorMcp",
    "claudeCodeMcp",
    "claudeDesktopMcp",
    "codexMcp",
    "chatgptMcp",
    "openclawMcp",
    "opencodeMcp",
    "agentsMcp"
  ];
  for (const key of legacyMcpKeys) {
    if (key in targets) {
      throw new CliSchemaValidationError(`configure.targets.${key} removed; MCP installs to ~/.agents/mcp.json when mcpServer.enabled`);
    }
  }
  const allowedKeys = new Set(["app", "configure"]);
  for (const key of Object.keys(targets)) {
    if (!allowedKeys.has(key)) {
      throw new CliSchemaValidationError(`configure.targets.${key} is not a valid target key`);
    }
  }
}
function cliValidateProgram(program) {
  if (!program.version || program.version.trim().length === 0) {
    throw new CliSchemaValidationError("CliProgram.version is required");
  }
  if (program.mcpServer !== undefined && program.mcpServer.enabled !== true) {
    throw new CliSchemaValidationError("mcpServer requires enabled: true; omit mcpServer to disable MCP");
  }
  if (program.httpServer !== undefined && program.httpServer.enabled !== true) {
    throw new CliSchemaValidationError("httpServer requires enabled: true; omit httpServer to disable HTTP API");
  }
  validateHttpPathPrefix(program);
  if (docsEnabled(program) && program.docs?.topics !== undefined) {
    validateDocsConfig(program.docs);
  }
  if (program.appConfig !== undefined) {
    validateConfigBlock(program.appConfig);
  }
  if (program.configure !== undefined) {
    validateConfigureConfig(program);
  }
  const caps = resolveCapabilities(program);
  const reserved = reservedCommandNames(caps);
  if (isCliRouter(program)) {
    for (const child of program.commands) {
      if (reserved.includes(child.key)) {
        throw new CliSchemaValidationError(`Reserved command name: ${child.key}`);
      }
    }
  }
  walkNode(program, program, true);
}
var PARAM_ROUTER_KEY = /^:[a-zA-Z][a-zA-Z0-9_]*$/;
function isParamRouterKey3(key) {
  return key.startsWith(":");
}
function validateHttpPathPrefix(program) {
  if (!program.httpServer?.enabled) {
    return;
  }
  const raw = program.httpServer.pathPrefix;
  if (raw !== undefined && raw !== "") {
    if (!raw.startsWith("/")) {
      throw new CliSchemaValidationError(`httpServer.pathPrefix must start with / (got ${JSON.stringify(raw)})`);
    }
    if (raw.length > 1 && raw.endsWith("/")) {
      throw new CliSchemaValidationError(`httpServer.pathPrefix must not end with / (got ${JSON.stringify(raw)})`);
    }
    if (raw.includes("//")) {
      throw new CliSchemaValidationError("httpServer.pathPrefix must not contain //");
    }
    if (raw === "/health" || raw === "/swagger" || raw === "/openapi.json" || raw === "/tools") {
      throw new CliSchemaValidationError(`httpServer.pathPrefix must not be a framework path (got ${JSON.stringify(raw)})`);
    }
    return;
  }
  if (!isCliRouter(program)) {
    if (isCliLeaf(program) && HTTP_RESERVED_TOP_LEVEL_SEGMENTS.has(program.key)) {
      throw new CliSchemaValidationError(`Reserved HTTP program key when httpServer.pathPrefix is empty: ${program.key}`);
    }
    return;
  }
  for (const child of program.commands) {
    if (HTTP_RESERVED_TOP_LEVEL_SEGMENTS.has(child.key)) {
      throw new CliSchemaValidationError(`Reserved HTTP command name when httpServer.pathPrefix is empty: ${child.key} (set httpServer.pathPrefix or rename)`);
    }
  }
}
function walkNode(node, program, isRoot) {
  if (!isRoot) {
    const rogue = node;
    if (rogue.mcpServer !== undefined) {
      throw new CliSchemaValidationError(`mcpServer is only supported on the program root (not on ${node.key})`);
    }
    if (rogue.httpServer !== undefined) {
      throw new CliSchemaValidationError(`httpServer is only supported on the program root (not on ${node.key})`);
    }
    if (rogue.configure !== undefined) {
      throw new CliSchemaValidationError(`configure is only supported on the program root (not on ${node.key})`);
    }
    if (rogue.docs !== undefined) {
      throw new CliSchemaValidationError(`docs is only supported on the program root (not on ${node.key})`);
    }
    if (rogue.appConfig !== undefined) {
      throw new CliSchemaValidationError(`appConfig is only supported on the program root (not on ${node.key})`);
    }
  }
  if (isCliLeaf(node)) {
    if (isRoot && node.mcpTool !== undefined) {
      throw new CliSchemaValidationError("mcpTool is only supported on leaf commands");
    }
    if (isDocumentLeaf(node)) {
      const kindStr = `kind: "${node.kind ?? "document"}"`;
      if (node.inputSchema === undefined) {
        throw new CliSchemaValidationError(`${kindStr} requires inputSchema on ${node.key}`);
      }
      if ((node.options ?? []).length > 0) {
        throw new CliSchemaValidationError(`${kindStr} forbids options on ${node.key}`);
      }
      if ((node.positionals ?? []).length > 0) {
        throw new CliSchemaValidationError(`${kindStr} forbids positionals on ${node.key}`);
      }
    }
    const outputSchema = node.outputSchema;
    if (outputSchema !== undefined && (typeof outputSchema !== "object" || outputSchema === null || Array.isArray(outputSchema))) {
      throw new CliSchemaValidationError("outputSchema must be a JSON Schema object (not null or an array)");
    }
    const inputSchema = node.inputSchema;
    if (inputSchema !== undefined && (typeof inputSchema !== "object" || inputSchema === null || Array.isArray(inputSchema))) {
      throw new CliSchemaValidationError("inputSchema must be a JSON Schema object (not null or an array)");
    }
    if (inputSchema !== undefined) {
      const properties = inputSchema.properties;
      if (properties !== undefined && (typeof properties !== "object" || properties === null || Array.isArray(properties))) {
        throw new CliSchemaValidationError(`inputSchema.properties must be an object on ${node.key}`);
      }
      if (properties) {
        for (const opt of node.options ?? []) {
          if (opt.kind === "json" /* Json */ && !(opt.name in properties)) {
            throw new CliSchemaValidationError(`Json option '${opt.name}' is missing from inputSchema.properties on ${node.key}`);
          }
        }
      }
    }
  } else {
    const rogue = node;
    if (rogue.mcpTool !== undefined) {
      throw new CliSchemaValidationError(`mcpTool is only supported on leaf commands (not on ${node.key})`);
    }
  }
  if (isRoot && program.mcpServer?.enabled === true && program.mcpServer.resources) {
    const schemaUri = resolveMcpSchemaUri(program);
    const reserved = new Set([schemaUri, ...reservedDocsTopicResourceUris(program)]);
    const uris = program.mcpServer.resources.map((r) => r.uri);
    for (const uri2 of uris) {
      if (reserved.has(uri2)) {
        const kind = uri2 === schemaUri ? "built-in schema resource" : "auto docs topic resource";
        throw new CliSchemaValidationError(`mcpServer.resources URI '${uri2}' conflicts with ${kind}`);
      }
    }
    if (new Set(uris).size !== uris.length) {
      throw new CliSchemaValidationError("mcpServer.resources URIs must be unique");
    }
  }
  if (isCliRouter(node)) {
    if (!isRoot && (node.options ?? []).length > 0) {
      throw new CliSchemaValidationError(`Options on routing group '${node.key}' are not supported — declare options on leaf commands`);
    }
    const seenNames = new Set;
    let paramRouterCount = 0;
    for (const child of node.commands) {
      if (seenNames.has(child.key)) {
        throw new CliSchemaValidationError(`Duplicate command name: ${child.key}`);
      }
      seenNames.add(child.key);
      if (isParamRouterKey3(child.key)) {
        if (!PARAM_ROUTER_KEY.test(child.key)) {
          throw new CliSchemaValidationError(`Param router key '${child.key}' must match :[a-zA-Z][a-zA-Z0-9_]* on '${node.key}'`);
        }
        if (!isCliRouter(child)) {
          throw new CliSchemaValidationError(`Param router '${child.key}' must be a router with subcommands`);
        }
        paramRouterCount++;
      }
    }
    if (paramRouterCount > 1) {
      throw new CliSchemaValidationError(`At most one param router per level on '${node.key}'`);
    }
    if (node.fallbackMode !== undefined && node.fallbackCommand === undefined) {
      throw new CliSchemaValidationError(`fallbackMode requires fallbackCommand on '${node.key}'`);
    }
    if (node.fallbackCommand !== undefined) {
      const valid = node.commands.find((c) => c.key === node.fallbackCommand);
      if (!valid) {
        throw new CliSchemaValidationError(`fallbackCommand '${node.fallbackCommand}' is not a child of '${node.key}'`);
      }
    }
    for (const child of node.commands) {
      walkNode(child, program, false);
    }
  }
  if (isCliRouter(node) && !isRoot) {
    validatePositionals(node.key, []);
  } else {
    const positionals = isCliLeaf(node) ? node.positionals ?? [] : [];
    validateOptions(node.key, node.options ?? []);
    validatePositionals(node.key, positionals);
  }
}
function validateOptions(scopeKey, options) {
  const seenShorts = new Set;
  let pipableCount = 0;
  for (const opt of options) {
    if (opt.pipable) {
      pipableCount++;
      if (opt.kind !== "json" /* Json */) {
        throw new CliSchemaValidationError(`pipable is only valid on Json kind: ${scopeKey}/${opt.name}`);
      }
    }
    if (opt.kind === "json" /* Json */) {
      if (opt.format !== undefined || opt.pattern !== undefined || opt.default !== undefined) {
        throw new CliSchemaValidationError(`Json option cannot use format, pattern, or default: ${scopeKey}/${opt.name}`);
      }
    }
    if (opt.required && opt.kind === "presence" /* Presence */) {
      throw new CliSchemaValidationError(`Presence option cannot be required: ${scopeKey}/${opt.name}`);
    }
    if (opt.shortName !== undefined) {
      if (opt.shortName === "h") {
        throw new CliSchemaValidationError(`Short alias -h is reserved for help: ${scopeKey}/${opt.name}`);
      }
      if (seenShorts.has(opt.shortName)) {
        throw new CliSchemaValidationError(`Duplicate short alias -${opt.shortName} in scope ${scopeKey}`);
      }
      seenShorts.add(opt.shortName);
    }
    if (opt.kind === "enum" /* Enum */) {
      if (!opt.choices || opt.choices.length === 0) {
        throw new CliSchemaValidationError(`Option '${opt.name}' on '${scopeKey}': Enum kind requires non-empty choices`);
      }
      if (new Set(opt.choices).size !== opt.choices.length) {
        throw new CliSchemaValidationError(`Option '${opt.name}' on '${scopeKey}': Enum choices must be distinct`);
      }
      for (const choice of opt.choices) {
        if (choice.length === 0) {
          throw new CliSchemaValidationError(`Option '${opt.name}' on '${scopeKey}': Enum choices must be non-empty strings`);
        }
      }
    } else if (opt.choices !== undefined) {
      throw new CliSchemaValidationError(`Option '${opt.name}' on '${scopeKey}': choices is only valid for Enum kind`);
    }
    if (opt.format !== undefined || opt.pattern !== undefined || opt.default !== undefined) {
      validateOptionValueMetadata(scopeKey, opt);
    }
  }
  if (pipableCount > 1) {
    throw new CliSchemaValidationError(`At most one pipable Json option per command: ${scopeKey}`);
  }
}
function validateOptionValueMetadata(scopeKey, opt) {
  const label = `${scopeKey}/${opt.name}`;
  if (opt.default !== undefined) {
    if (opt.kind === "presence" /* Presence */) {
      throw new CliSchemaValidationError(`default is not valid on presence option ${label}`);
    }
    if (opt.required) {
      throw new CliSchemaValidationError(`default cannot be set on required option ${label}`);
    }
  }
  if (opt.format !== undefined && opt.pattern !== undefined) {
    throw new CliSchemaValidationError(`Option ${label}: format and pattern are mutually exclusive`);
  }
  if (opt.format !== undefined) {
    if (opt.kind !== "string" /* String */) {
      throw new CliSchemaValidationError(`Option ${label}: format is only valid on String kind`);
    }
    if (!Object.values(CliValueFormat).includes(opt.format)) {
      throw new CliSchemaValidationError(`Option ${label}: unknown format '${opt.format}'`);
    }
  }
  if (opt.pattern !== undefined) {
    if (opt.kind !== "string" /* String */) {
      throw new CliSchemaValidationError(`Option ${label}: pattern is only valid on String kind`);
    }
    try {
      new RegExp(opt.pattern);
    } catch {
      throw new CliSchemaValidationError(`Option ${label}: invalid pattern regex`);
    }
  }
  if (opt.default !== undefined) {
    try {
      validateFormatValue(opt.default, opt.format, opt.pattern);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CliSchemaValidationError(`Option ${label}: invalid default: ${msg}`);
    }
  }
}
function validatePositionals(scopeKey, positionals) {
  for (const p of positionals) {
    if (p.argMin !== undefined && p.argMin < 0) {
      throw new CliSchemaValidationError(`argMin must be >= 0 for positional ${scopeKey}/${p.name}`);
    }
    if (p.argMax !== undefined && p.argMax < 0) {
      throw new CliSchemaValidationError(`argMax must be >= 0 (use 0 for unlimited) for positional ${scopeKey}/${p.name}`);
    }
    const { argMin = 1, argMax = 1 } = p;
    if (argMax > 0 && argMin > argMax) {
      throw new CliSchemaValidationError(`argMin must not exceed argMax for positional ${scopeKey}/${p.name}`);
    }
  }
  let sawOptional = false;
  for (const p of positionals) {
    const { argMin = 1 } = p;
    if (argMin === 0) {
      sawOptional = true;
    } else if (sawOptional) {
      throw new CliSchemaValidationError(`Required positional after optional in scope ${scopeKey}`);
    }
  }
  for (let idx = 0;idx < positionals.length; idx++) {
    const positional = positionals[idx];
    if (!positional) {
      continue;
    }
    const { argMax = 1 } = positional;
    if (argMax === 0 && idx + 1 < positionals.length) {
      throw new CliSchemaValidationError(`Unlimited positional (argMax == 0) must be last in scope ${scopeKey}`);
    }
  }
}

// ../bun-argsbarg/src/hooks/builtin.ts
var BUILTIN_ROOTS = new Set(["completion", "version", "http", "mcp", "configure", "docs"]);
function isBuiltinInvokePath(path) {
  const root = path[0];
  if (!root || !BUILTIN_ROOTS.has(root)) {
    return false;
  }
  if (root === "http") {
    return path.length <= 1 || path[1] === "serve";
  }
  if (root === "mcp") {
    return path.length <= 1 || path[1] === "serve" || path[1] === "bundle";
  }
  return true;
}

// ../bun-argsbarg/src/mcp/env.ts
import { spawnSync } from "node:child_process";
function captureShellEnv(shell) {
  const result = spawnSync(shell, ["-l", "-c", "env"], {
    encoding: "utf8",
    timeout: 5000
  });
  if (result.error || result.status !== 0) {
    return {};
  }
  const env = {};
  for (const line of result.stdout.split(`
`)) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      env[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return env;
}
function applyShellEnv(env) {
  for (const [key, val] of Object.entries(env)) {
    if (key === "PATH") {
      const existing = process.env.PATH ?? "";
      const existingParts = new Set(existing.split(":"));
      const shellOnly = val.split(":").filter((p) => p.length > 0 && !existingParts.has(p));
      if (shellOnly.length > 0) {
        process.env.PATH = [...shellOnly, existing].join(":");
      }
    } else if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}
function bootstrapMcpEnv(config) {
  if (config.shellEnv === false) {
    return;
  }
  const shellEnvCfg = config.shellEnv;
  const shell = typeof shellEnvCfg === "string" ? shellEnvCfg : process.env.SHELL ?? (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  const captured = captureShellEnv(shell);
  if (Object.keys(captured).length === 0) {
    process.stderr.write(`[argsbarg] shellEnv: failed to capture shell environment from ${shell}
`);
  } else {
    applyShellEnv(captured);
  }
}

// ../bun-argsbarg/src/mcp/server.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var MCP_PROTOCOL_VERSION = "2024-11-05";
function writeResponse(msg) {
  process.stdout.write(`${JSON.stringify(msg)}
`);
}
function writeError(id, code, message) {
  if (id === undefined) {
    return;
  }
  writeResponse({
    jsonrpc: "2.0",
    id,
    error: { code, message }
  });
}
async function handleRequestLine(cli, line) {
  const root = cli.program;
  const requestId = randomUUID2();
  const started = performance.now();
  const hooks = cli.server?.mcpHooks ?? root.mcpServer?.hooks;
  const emitter = cli.server?.emitter;
  const obscureUnexpected = cli.server?.mcp?.obscureUnexpected ?? root.mcpServer?.errors?.obscureUnexpected ?? false;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const id = req.id;
  const hasId = id !== undefined;
  const method = req.method ?? "";
  const params = req.params ?? {};
  const wireCtx = { rpcMethod: method, requestId };
  await hooks?.onRequest?.(wireCtx);
  const finish = async (failureKind, error) => {
    const durationMs = Math.round(performance.now() - started);
    if (failureKind && error !== undefined) {
      await hooks?.onError?.({
        ...wireCtx,
        failureKind,
        error
      });
    } else {
      await hooks?.onResponse?.({ ...wireCtx, durationMs });
    }
    emitter?.emitAccess({
      method: "MCP",
      path: method,
      status: failureKind ? 500 : 200,
      durationMs,
      requestId
    });
  };
  if (req.jsonrpc !== "2.0") {
    if (hasId) {
      writeError(id, -32600, "Invalid Request");
    }
    await finish("validation", new Error("Invalid Request"));
    return;
  }
  if (method === "notifications/initialized") {
    return;
  }
  if (!hasId) {
    return;
  }
  try {
    if (method === "initialize") {
      const info = resolveMcpServerInfo(root);
      writeResponse({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: info.name, version: info.version }
        }
      });
      await finish();
      return;
    }
    if (method === "ping") {
      writeResponse({ jsonrpc: "2.0", id, result: {} });
      await finish();
      return;
    }
    if (method === "tools/list") {
      const tools = collectMcpTools(root).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...t.outputSchema === undefined ? {} : { outputSchema: t.outputSchema }
      }));
      writeResponse({ jsonrpc: "2.0", id, result: { tools } });
      await finish();
      return;
    }
    if (method === "tools/call") {
      const name = params.name;
      if (typeof name !== "string") {
        writeError(id, -32602, "Invalid params: name required");
        await finish("validation", new Error("Invalid params: name required"));
        return;
      }
      const rawArgs = params.arguments;
      if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
        writeError(id, -32602, "Invalid params: arguments must be an object");
        await finish("validation", new Error("Invalid params: arguments must be an object"));
        return;
      }
      const lookup = lookupHeadlessTool(root, name);
      if (!lookup.ok) {
        if (lookup.kind === "unknown") {
          writeError(id, -32602, lookup.message);
          await finish("unknown_route", new Error(lookup.message));
          return;
        }
        writeResponse({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: lookup.message }],
            isError: true
          }
        });
        await finish("missing_config", new Error(lookup.message));
        return;
      }
      const invokeResult = await executeHeadlessToolCall(cli, lookup.tool, rawArgs ?? {}, "mcp", { rpcMethod: method, toolName: name, requestId });
      if (invokeResult.ok) {
        writeResponse({
          jsonrpc: "2.0",
          id,
          result: invokeResult.mcpResult
        });
        await finish();
        return;
      }
      const text = headlessFailureMcpMessage(invokeResult, obscureUnexpected);
      writeResponse({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text }],
          isError: true
        }
      });
      await finish(invokeResult.failureKind ?? "invoke", new Error(invokeResult.message));
      return;
    }
    if (method === "resources/list") {
      const resources = allMcpResources(root).map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType
      }));
      writeResponse({ jsonrpc: "2.0", id, result: { resources } });
      await finish();
      return;
    }
    if (method === "resources/read") {
      const uri2 = params.uri;
      if (typeof uri2 !== "string") {
        writeError(id, -32602, "Invalid params: uri required");
        await finish("validation", new Error("Invalid params: uri required"));
        return;
      }
      const all = allMcpResources(root);
      const found = all.find((r) => r.uri === uri2);
      if (!found) {
        writeError(id, -32602, `Unknown resource: ${uri2}`);
        await finish("unknown_route", new Error(`Unknown resource: ${uri2}`));
        return;
      }
      let text;
      try {
        text = found.load();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeError(id, -32603, `Resource load failed: ${message}`);
        await finish("unexpected", err);
        return;
      }
      writeResponse({
        jsonrpc: "2.0",
        id,
        result: {
          contents: [
            {
              uri: found.uri,
              mimeType: found.mimeType,
              text
            }
          ]
        }
      });
      await finish();
      return;
    }
    writeError(id, -32601, "Method not found");
    await finish("unknown_route", new Error("Method not found"));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    writeError(id, -32603, message);
    await finish("unexpected", err);
  }
}
async function mcpServeStdioLoop(cli) {
  let buffer = "";
  const decoder = new TextDecoder;
  for await (const chunk of process.stdin) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk);
    let nl = buffer.indexOf(`
`);
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length === 0) {
        nl = buffer.indexOf(`
`);
        continue;
      }
      await handleRequestLine(cli, line);
      nl = buffer.indexOf(`
`);
    }
  }
  const trailing = buffer.trim();
  if (trailing.length > 0) {
    await handleRequestLine(cli, trailing);
  }
}

// ../bun-argsbarg/src/server/context.ts
function createServerRuntime(program, surface) {
  return { state: {}, program, surface };
}

// ../bun-argsbarg/src/runtime/cli.ts
class CliInvokeExit extends Error {
  code;
  constructor(code) {
    super(`process.exit(${code})`);
    this.name = "CliInvokeExit";
    this.code = code;
  }
}

class Cli {
  program;
  caps;
  parseRootMerged;
  presentationRoot;
  _appConfig;
  server;
  constructor(program) {
    cliValidateProgram(program);
    Object.freeze(program);
    this.program = program;
    this.caps = resolveCapabilities(program);
    this.parseRootMerged = cliParseRoot(program);
    this.presentationRoot = cliPresentationRoot(program);
  }
  get appConfig() {
    if (this._appConfig === undefined) {
      this._appConfig = this.buildAppConfigSnapshot({
        exitOnMissing: false,
        interactive: false
      });
    }
    return this._appConfig;
  }
  exportCommandSchema() {
    return cliSchemaExport(this.program);
  }
  exportAppConfigSchema() {
    return effectiveJsonSchema(this.program);
  }
  async run(argv = process.argv.slice(2)) {
    assertBuiltinAllowed(argv, this.caps);
    const prep = this.prepareDispatch(argv);
    if ("error" in prep) {
      if (prep.error.kind === "help" /* Help */) {
        process.stdout.write(cliHelpRender(this.parseRootMerged, prep.error.helpPath, false));
        process.exit(prep.error.helpExplicit ? 0 : 1);
      }
      const color = process.stderr.isTTY;
      const msg = color ? `\x1B[31m${prep.error.errorMsg}\x1B[0m` : prep.error.errorMsg;
      process.stderr.write(`${msg}
`);
      process.stderr.write(cliHelpRender(this.presentationRoot, prep.error.errorHelpPath, true));
      process.exit(1);
    }
    const { pr, completionParseRoot, isLeafCompletionIntercept, leaf } = prep;
    if (pr.kind === "ok" /* Ok */) {
      await dispatchBuiltin(this.program, pr, {
        isLeafCompletionIntercept,
        parseRoot: completionParseRoot
      });
    }
    const skipRequiredConfig = skipsRequiredAppConfigExit(pr.path, this.caps);
    const snapshot = this.buildAppConfigSnapshot({
      interactive: !skipRequiredConfig && !!process.stdin.isTTY,
      exitOnMissing: !skipRequiredConfig
    });
    let preloadedJson = {};
    try {
      preloadedJson = await preloadPipableJson(this.program, pr.path, pr.opts, "cli", pr.args);
    } catch (err) {
      if (err instanceof LeafInputError) {
        this.exitLeafInputError(err, pr.path);
      }
      const msg = err instanceof Error ? err.message : String(err);
      const color = process.stderr.isTTY;
      process.stderr.write(color ? `\x1B[31m${msg}\x1B[0m
` : `${msg}
`);
      process.exit(1);
    }
    const ctx = new CliContext(this.program.key, pr.path, pr.args, pr.opts, this.program, "cli", snapshot, undefined, preloadedJson, pr.pathParams, { requestId: randomUUID3() });
    try {
      this.ensureValidatedLeafInputs(ctx, leaf);
      const handlerResult = await Promise.resolve(leaf.handler(ctx));
      if (handlerResult !== undefined && ctx.getResponse() === undefined) {
        ctx.respond({ body: handlerResult });
      }
      process.exit(0);
    } catch (err) {
      if (err instanceof LeafInputError) {
        this.exitLeafInputError(err, pr.path);
      }
      if (err instanceof Error) {
        process.stderr.write(`${err.message}
`);
      }
      process.exit(1);
    }
  }
  async invoke(argv, opts) {
    const invocation = opts?.invocation ?? "mcp";
    const prep = this.prepareDispatch(argv, { presentationFallback: true });
    if ("error" in prep) {
      if (prep.error.kind === "help" /* Help */) {
        return {
          kind: "help",
          exitCode: 1,
          stdout: "",
          stderr: "",
          errorMsg: "Help is not available via tool calls.",
          failureKind: "help"
        };
      }
      return {
        kind: "error",
        exitCode: 1,
        stdout: "",
        stderr: prep.error.errorMsg,
        errorMsg: prep.error.errorMsg,
        failureKind: "validation"
      };
    }
    const { pr, completionParseRoot, isLeafCompletionIntercept, leaf } = prep;
    const snapshot = this.buildAppConfigSnapshot({
      interactive: false,
      exitOnMissing: false
    });
    const runtime = this.server?.runtime;
    const requestId = opts?.requestId ?? opts?.http?.requestId ?? opts?.mcp?.requestId ?? randomUUID3();
    const ctx = new CliContext(this.program.key, pr.path, pr.args, pr.opts, this.program, invocation, snapshot, opts?.toolArgs, {}, pr.pathParams, { requestId }, runtime);
    const skipHooks = isBuiltinInvokePath(pr.path);
    const hooks = this.program.hooks;
    const obscureUnexpected = invocation === "http" ? this.server?.http?.obscureUnexpected ?? this.program.httpServer?.errors?.obscureUnexpected ?? false : invocation === "mcp" ? this.server?.mcp?.obscureUnexpected ?? this.program.mcpServer?.errors?.obscureUnexpected ?? false : false;
    const emitter = this.server?.emitter;
    const hookCtx = () => buildInvokeHookContext(ctx, {
      path: pr.path,
      runtime,
      http: opts?.http,
      mcp: opts?.mcp
    });
    let stdout = "";
    let stderr = "";
    const origExit = process.exit;
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    const origConsoleLog = console.log;
    const origConsoleError = console.error;
    const origConsoleInfo = console.info;
    const origConsoleWarn = console.warn;
    process.exit = (code) => {
      throw new CliInvokeExit(code ?? 0);
    };
    process.stdout.write = (chunk, ...args) => {
      stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      if (typeof args[0] === "function") {
        args[0]();
      }
      return true;
    };
    process.stderr.write = (chunk, ...args) => {
      stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      if (typeof args[0] === "function") {
        args[0]();
      }
      return true;
    };
    console.log = (...args) => {
      stdout += `${format2(...args)}
`;
    };
    console.info = (...args) => {
      stdout += `${format2(...args)}
`;
    };
    console.warn = (...args) => {
      stderr += `${format2(...args)}
`;
    };
    console.error = (...args) => {
      stderr += `${format2(...args)}
`;
    };
    const finishError = async (err, kindOpts) => {
      const failureKind = classifyFailureKind(err, kindOpts);
      if (!skipHooks) {
        const piped = await runErrorPipeline(hookCtx(), err, failureKind, hooks, emitter, obscureUnexpected);
        return {
          kind: "error",
          exitCode: piped.clientError.exitCode ?? 1,
          stdout,
          stderr: `${piped.errorMsg}
`,
          errorMsg: piped.errorMsg,
          failureKind: piped.failureKind
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        kind: "error",
        exitCode: 1,
        stdout,
        stderr: `${message}
`,
        errorMsg: message,
        failureKind
      };
    };
    try {
      if (pr.kind === "ok" /* Ok */) {
        await dispatchBuiltin(this.program, pr, {
          isLeafCompletionIntercept,
          parseRoot: completionParseRoot
        });
      }
      if (!skipHooks) {
        await runHook(() => hooks?.beforeInvoke?.(hookCtx()), "beforeInvoke");
      }
      this.ensureValidatedLeafInputs(ctx, leaf);
      const handlerResult = await Promise.resolve(leaf.handler(ctx));
      if (handlerResult !== undefined && ctx.getResponse() === undefined) {
        ctx.respond({ body: handlerResult });
      }
      const response = ctx.getResponse();
      const okResult = {
        kind: "ok",
        exitCode: 0,
        stdout,
        stderr,
        ...response ? { response } : {}
      };
      if (!skipHooks) {
        await runHook(() => hooks?.afterInvoke?.({ ...hookCtx(), result: okResult }), "afterInvoke");
      }
      return okResult;
    } catch (err) {
      if (err instanceof CliInvokeExit) {
        if (err.code === 0) {
          const response = ctx.getResponse();
          const okResult = {
            kind: "ok",
            exitCode: 0,
            stdout,
            stderr,
            ...response ? { response } : {}
          };
          if (!skipHooks) {
            await runHook(() => hooks?.afterInvoke?.({ ...hookCtx(), result: okResult }), "afterInvoke");
          }
          return okResult;
        }
        return finishError(err, {});
      }
      if (err instanceof LeafInputError) {
        return finishError(err, { parseError: true });
      }
      if (err instanceof Error) {
        return finishError(err, {});
      }
      return finishError(err, {});
    } finally {
      process.exit = origExit;
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
      console.log = origConsoleLog;
      console.error = origConsoleError;
      console.info = origConsoleInfo;
      console.warn = origConsoleWarn;
    }
  }
  async serveMcp(overrides = {}) {
    try {
      if (this.program.mcpServer) {
        bootstrapMcpEnv(this.program.mcpServer);
      }
      const resolved = resolveMcpServeConfig(this.program, overrides);
      const runtime = createServerRuntime(this.program, "mcp");
      const emitter = new LogEmitter({ program: this.program, resolved: resolved.log });
      this.server = {
        runtime,
        emitter,
        mcp: resolved,
        mcpHooks: this.program.mcpServer?.hooks
      };
      bootstrapAppConfig(this.program, { validateFile: "soft", runtime, emitter });
      const shutdown = () => {
        emitter.emit({ level: "info", message: "server stopping", action: "server.stop" });
        process.exit(0);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      emitter.emitLifecycle(`${this.program.key} ${this.program.version} — MCP ready (stdio)`, "mcp.server.ready");
      await mcpServeStdioLoop(this);
      process.exit(0);
    } catch (err) {
      if (err instanceof Error) {
        process.stderr.write(`${err.message}
`);
      } else {
        process.stderr.write(`MCP server error.
`);
      }
      process.exit(1);
    }
  }
  async serveHttp(overrides = {}) {
    try {
      const resolved = resolveHttpServeConfig(this.program, overrides);
      const runtime = createServerRuntime(this.program, "http");
      const emitter = new LogEmitter({ program: this.program, resolved: resolved.log });
      this.server = {
        runtime,
        emitter,
        http: resolved,
        httpHooks: this.program.httpServer?.hooks
      };
      bootstrapAppConfig(this.program, { validateFile: "soft", runtime, emitter });
      const shutdown = () => {
        emitter.emit({ level: "info", message: "server stopping", action: "server.stop" });
        process.exit(0);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      await httpServeHttp(this, resolved);
      process.exit(0);
    } catch (err) {
      if (err instanceof Error) {
        process.stderr.write(`${err.message}
`);
      } else {
        process.stderr.write(`HTTP API server error.
`);
      }
      process.exit(1);
    }
  }
  ensureValidatedLeafInputs(ctx, leaf) {
    if (leaf.inputSchema === undefined) {
      return;
    }
    ctx.inputs;
  }
  exitLeafInputError(err, helpPath) {
    const color = process.stderr.isTTY;
    const msg = color ? `\x1B[31m${err.message}\x1B[0m` : err.message;
    process.stderr.write(`${msg}
`);
    process.stderr.write(cliHelpRender(this.presentationRoot, helpPath, true));
    process.exit(1);
  }
  prepareDispatch(argv, opts) {
    const program = this.program;
    let parseRoot;
    let completionParseRoot = opts?.presentationFallback ? this.presentationRoot : this.parseRootMerged;
    let isLeafCompletionIntercept = false;
    if (isCliLeaf(program)) {
      const intercept = builtinInterceptRoot(program, argv);
      if (intercept.isLeafCompletionIntercept || intercept.parseRoot !== program) {
        parseRoot = intercept.parseRoot;
        completionParseRoot = isCliRouter(intercept.parseRoot) ? intercept.parseRoot : opts?.presentationFallback ? this.presentationRoot : this.parseRootMerged;
        isLeafCompletionIntercept = intercept.isLeafCompletionIntercept;
      } else {
        parseRoot = program;
      }
    } else {
      parseRoot = this.parseRootMerged;
    }
    let pr = parse(parseRoot, argv);
    pr = postParseValidate(parseRoot, pr);
    if (pr.kind !== "ok" /* Ok */) {
      return { error: pr };
    }
    let current = parseRoot;
    for (const seg of pr.path) {
      if (!isCliRouter(current)) {
        const msg = "Internal error: missing handler for path.";
        return {
          error: {
            kind: "error" /* Error */,
            path: pr.path,
            args: pr.args,
            opts: pr.opts,
            pathParams: pr.pathParams,
            helpExplicit: false,
            helpPath: [],
            errorMsg: msg,
            errorHelpPath: pr.path
          }
        };
      }
      const ch = current.commands.find((candidate) => candidate.key === seg);
      if (!ch) {
        const msg = "Internal error: missing handler for path.";
        return {
          error: {
            kind: "error" /* Error */,
            path: pr.path,
            args: pr.args,
            opts: pr.opts,
            pathParams: pr.pathParams,
            helpExplicit: false,
            helpPath: [],
            errorMsg: msg,
            errorHelpPath: pr.path
          }
        };
      }
      current = ch;
    }
    if (!isCliLeaf(current) || !current.handler) {
      const msg = "Internal error: missing handler for path.";
      return {
        error: {
          kind: "error" /* Error */,
          path: pr.path,
          args: pr.args,
          opts: pr.opts,
          pathParams: pr.pathParams,
          helpExplicit: false,
          helpPath: [],
          errorMsg: msg,
          errorHelpPath: pr.path
        }
      };
    }
    return {
      pr,
      parseRoot,
      completionParseRoot,
      isLeafCompletionIntercept,
      leaf: current
    };
  }
  buildAppConfigSnapshot(opts) {
    const bootstrap = ensureAppConfig(this.program, opts);
    const snapshot = bootstrap ? createAppConfigSnapshot(this.program, bootstrap.fileData, bootstrap.resolved) : createAppConfigSnapshot(this.program, readAppConfigFileRaw(resolveAppConfigPath(this.program)), {});
    this._appConfig = snapshot;
    return snapshot;
  }
}
// README.md
var README_default = `![Logo](logo.png)
<!-- https://patorjk.com/software/taag/#p=display&f=Double&t=gdoc+smith&x=none&v=4&h=4&w=80&we=false -->

# gdocsmith - ai plugin

**The missing intelligence layer between AI coding agents and Google Docs.**

Giving an AI agent direct access to Google APIs is a recipe for disaster. Because the native API is very limited and finicky, agents routinely make mistakes and aren't able to detect or recover from many mistakes. It's common to completely break a page, butcher the layout, make so many mistakes that it's not worth using AI at all.

\`gdocsmith\` helps agents avoid mistakes altogether, while also reducing effort 10x.

## Why Google Docs breaks AI agents

The native Docs API was designed for batch backend scripts, not LLMs:

1. **Fragile character offsets**: Edits rely on absolute character indices (\`startIndex\`/\`endIndex\`). Any upstream edit shifts every offset, guaranteeing off-by-one errors and clobbered headings.
2. **No native Markdown**: Inserting basic Markdown requires dozens of deeply nested JSON structures (\`insertText\`, \`updateTextStyle\`, \`createParagraphBullets\`).
3. **Destructive rewrites**: Because surgical edits are hard, agents wipe whole sections—destroying inline human comments, suggestion tracks, and revision history.
4. **No structural awareness**: No way to query document outlines, check list nesting, diff changes, or clone nodes.
5. **Silent formatting corruption**: A single missing newline or misordered list call silently breaks document layout.

## How gdocsmith fixes it

\`gdocsmith\` gives agents safe, surgical hands:

- **Stable scoped IDs (\`h.arch.9a1b\`)**: Outline nodes use heading-scoped checksums instead of volatile character offsets, letting agents target content reliably across revisions.
- **Native Markdown**: Agents author in standard Markdown (headings, lists, tables, callouts, code blocks); gdocsmith compiles it directly into native Google Docs styled elements.
- **Semantic color & callout queries (\`fontColors: ["red"]\`, \`["!default"]\`)**: Find warnings, blockers, and review marks by color name or exclusion without decoding raw RGB floats.
- **2D table & list scoping (\`rows\`, \`cols\`, \`sameList\`)**: Target specific cells (\`h.arch.table.0.1.3c8f\`) without clobbering column widths, and treat bullet lists as logical subtrees.
- **Zero turn tax**: Batch document creation, tab management, queries, and edits into a single 5-second tool call with in-memory aliasing (\`as:\` → \`doc:\`, \`tab:\`).
- **Anti-demolition guardrails**: Blocks agents from deleting and recreating unchanged text, protecting human comments and version history ([docs/guards.md](docs/guards.md)).
- **Single declarative MCP tool**: One \`run\` workflow contract instead of 15+ chatty tools, cutting prompt bloat and hallucinations.
- **Aesthetic defaults**: Native Google Docs styling presets prevent ugly agent formatting hacks ([docs/style.md](docs/style.md)).

## How it works

Workflows run in three simple steps:

1. **Inspect**: Query headings, bullet trees, table rows/cols, or text colors (\`query\`). Matches return stable IDs (e.g. \`h.arch.9a1b\`, cell \`h.arch.table.0.1.3c8f\`).
2. **Mutate**: Target verified IDs with surgical edits or Markdown insertions (\`nodeAt\`, \`nodeAfter\`, \`nodeBefore\`, \`nodeUnder\`).
3. **Batch**: Chain creation (\`docCreate\`), tabs (\`tabCreate\`), and insertions in one pass using aliases (\`as: "spec"\` → \`doc: "spec"\`).

### Workflow Example

\`\`\`json
{
  "dryRun": false,
  "steps": [
    { "kind": "docCreate", "title": "Architecture RFC", "as": "rfc" },
    {
      "kind": "markdownInsert",
      "doc": "rfc",
      "markdown": "# Architecture RFC\\n\\n## Overview\\n\\nThis RFC proposes the document transformation pipeline.\\n\\n## Components\\n\\n- Ingestion engine\\n- Transformation pipeline"
    },
    {
      "kind": "query",
      "doc": "rfc",
      "contains": "Components",
      "as": "componentsHeading"
    }
  ]
}
\`\`\`

The query result in \`dumped.componentsHeading\` contains the matching node ID (\`h.comp.2c4e\`), which can be targeted in subsequent steps without computing character offsets.

## Installation & Setup

### 1. Cursor Plugin

Install directly via the Cursor Marketplace, or link for local development:

\`\`\`bash
git clone https://github.com/bdombro/gdocsmith.git
cd gdocsmith
just install-plugin-cursor
\`\`\`

The plugin automatically provides \`.cursor-plugin/plugin.json\`, \`mcp.json\`, and the bundled zero-dependency Node runner at \`scripts/mcp.mjs\`.

### 2. Claude Code Plugin

\`gdocsmith\` includes native Claude Code plugin manifests:
- \`.claude-plugin/plugin.json\`
- \`.mcp.json\`

### 3. Authentication

\`gdocsmith\` uses credentials from the official Google Workspace CLI ([\`gws\`](https://github.com/googleworkspace/cli)). If you have \`gws\` installed and authenticated (\`gws auth login\`), no additional setup is required.

## MCP Tools

- \`run\` *(Primary)*: Execute an ordered Google Docs workflow from JSON (\`steps\` with \`kind\`).
- \`status\`: Print application version and verify environment health.

## CLI Usage (Testing & Debugging)

The CLI is provided for local testing, dry runs, and piping JSON workflows during development:

\`\`\`bash
gdocsmith run < workflow.json
\`\`\`

See [docs/cli.md](docs/cli.md) for full CLI documentation and options.

## Documentation

| Need                                | File                                                   |
| ----------------------------------- | ------------------------------------------------------ |
| Agent skill router                  | [skills/gdocsmith/SKILL.md](skills/gdocsmith/SKILL.md) |
| MCP server reference                | [docs/mcp.md](docs/mcp.md)                             |
| CLI reference (testing & debugging) | [docs/cli.md](docs/cli.md)                             |
| Architecture / maintainer guide     | [docs/architecture.md](docs/architecture.md)           |
| Edit loop & runbook                 | [docs/runbook-diagram.md](docs/runbook-diagram.md)     |
| Selectors & DOM ops                 | [docs/mechanics.md](docs/mechanics.md)                 |
| Aesthetic & formatting taste        | [docs/style.md](docs/style.md)                         |
| Markdown ingestion                  | [docs/markdown.md](docs/markdown.md)                   |
| Feature matrix & API limits         | [docs/features.md](docs/features.md)                   |
| Guardrails & anti-demolition        | [docs/guards.md](docs/guards.md)                       |
| Images                              | [docs/images.md](docs/images.md)                       |
| Comments                            | [docs/comments.md](docs/comments.md)                   |
`;

// scripts/createIdentity.ts
var identityCreate = {
  className: "Gdocsmith",
  desc: "Google Docs surgical authoring and workflow engine",
  envPrefix: "GDOCSMITH",
  homepage: "https://github.com/bdombro/gdocsmith",
  key: "gdocsmith",
  releaseRepo: "bdombro/gdocsmith",
  tap: "bdombro/gdocsmith",
  template: "json"
};
var createIdentity = identityCreate;

// src/core/gws.ts
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";

// src/core/auth.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// src/core/config.ts
import { mkdirSync as mkdirSync9, readFileSync as readFileSync5, writeFileSync as writeFileSync8 } from "node:fs";
import { homedir } from "node:os";
import { join as join11 } from "node:path";
function cacheDbPath() {
  if (process.env.GDOCSMITH_CACHE_DB)
    return process.env.GDOCSMITH_CACHE_DB;
  if (process.env.GDOCSMITH_CACHE_DIR === ":memory:")
    return ":memory:";
  return join11(cacheDir(), "db.sqlite");
}
function cacheDir() {
  return process.env.GDOCSMITH_CACHE_DIR ?? join11(homedir(), ".cache", "gdocsmith");
}
function skillConfigLoad() {
  try {
    return JSON.parse(readFileSync5(configFile(), "utf8"));
  } catch {
    return {};
  }
}
function skillConfigSave(patch) {
  const dir = configDir();
  mkdirSync9(dir, { recursive: true });
  const config = { ...skillConfigLoad(), ...patch };
  writeFileSync8(configFile(), JSON.stringify(config, null, 2));
  return config;
}
function configDir() {
  return process.env.GDOCSMITH_CONFIG_DIR ?? join11(homedir(), ".config", "gdocsmith");
}
function configFile() {
  return join11(configDir(), "config.json");
}

// src/core/auth.ts
var execFileAsync = promisify(execFile);
async function accessTokenRefresh(creds) {
  const credentials = creds ?? await gwsCredentialsGet();
  let res;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      body: new URLSearchParams({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        grant_type: "refresh_token",
        refresh_token: credentials.refresh_token
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      method: "POST"
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Google OAuth token refresh failed: ${msg}`);
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${errText}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("No access_token returned by Google OAuth endpoint");
  }
  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  const token = {
    access_token: data.access_token,
    expires_at: Date.now() + Math.max(0, expiresInMs - 60000),
    token_type: data.token_type
  };
  memTokenCache = token;
  try {
    skillConfigSave({
      oauthToken: token
    });
  } catch {}
  return token;
}
async function gwsCredentialsGet() {
  let stdout;
  try {
    const res = await execFileAsync("gws", ["auth", "export", "--unmasked"]);
    stdout = res.stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to export credentials from gws: ${msg}`);
  }
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed.client_id || !parsed.client_secret || !parsed.refresh_token) {
      throw new Error("Missing required OAuth fields in gws credentials");
    }
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid gws auth export output: ${msg}`);
  }
}
async function validAccessTokenGet(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && memTokenCache && memTokenCache.expires_at > now) {
    return memTokenCache.access_token;
  }
  if (!forceRefresh) {
    const config = skillConfigLoad();
    const diskToken = config.oauthToken;
    if (diskToken && diskToken.expires_at > now) {
      memTokenCache = diskToken;
      return diskToken.access_token;
    }
  }
  const refreshed = await accessTokenRefresh();
  return refreshed.access_token;
}
var getValidAccessToken = validAccessTokenGet;
var memTokenCache = null;

// src/core/fetchWithRetry.ts
async function fetchWithRetry(url, init, options = {}) {
  const { backoffMs = 500, fetcher = fetchGoogleApi, retries = 3 } = options;
  let lastError;
  for (let attempt = 0;attempt < retries; attempt++) {
    try {
      const res = await fetcher(url, init);
      if ((res.status === 429 || res.status >= 500 && res.status !== 501) && attempt < retries - 1) {
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1 && isTransientError(err)) {
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  if (lastError)
    throw lastError;
  throw new Error(`Fetch failed after ${retries} attempts: ${url}`);
}
function isTransientError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /HTTP request failed|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|network timeout/i.test(msg);
}
function sleep(ms) {
  return new Promise((resolve5) => setTimeout(resolve5, ms));
}

// src/core/gws.ts
var execFileAsync2 = promisify2(execFile2);
var DOCS_BASE_URL = "https://docs.googleapis.com/v1";
var DRIVE_BASE_URL = "https://www.googleapis.com/drive/v3";
function gwsErrorFormat(raw, targetId) {
  if (!raw?.trim()) {
    return targetId ? `GWS operation failed for target ${targetId}` : "GWS operation failed";
  }
  const trimmed = raw.trim();
  let apiMessage;
  let status;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.error) {
      status = parsed.error.code ?? parsed.error.status;
      apiMessage = parsed.error.message;
    }
  } catch {
    const match = trimmed.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.error) {
          status = parsed.error.code ?? parsed.error.status;
          apiMessage = parsed.error.message;
        }
      } catch {}
    }
  }
  const combined = `${trimmed} ${apiMessage ?? ""}`;
  if (status === 403 || /insufficient(File)?Permissions/i.test(combined) || /does not have permission/i.test(combined) || /not have write access/i.test(combined) || /Access denied/i.test(combined)) {
    const idHint = targetId ? ` on "${targetId}"` : "";
    const detail = apiMessage ? `: ${apiMessage}` : "";
    return `Permission denied${idHint}. You do not have sufficient permissions (e.g. view-only access, or restricted shared drive)${detail}.`;
  }
  if (status === 404 || /notFound/i.test(combined) || /File not found/i.test(combined) || /Requested entity was not found/i.test(combined)) {
    const idHint = targetId ? ` "${targetId}"` : "";
    return `Document or file not found${idHint}. Check that the ID or URL is correct and shared with your account.`;
  }
  if (status === 401 || /invalid_grant|invalid authentication credentials|Unauthorized|Login Required/i.test(combined)) {
    return "Google Workspace authentication expired or invalid. Run 'gws auth login' to re-authenticate.";
  }
  return apiMessage ? `Google API error (${status ?? "error"}): ${apiMessage}` : trimmed;
}
var formatGwsError = gwsErrorFormat;
async function googleApiFetch(url, options = {}) {
  let token = await getValidAccessToken();
  let res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`
    }
  });
  if (res.status === 401) {
    token = await getValidAccessToken(true);
    res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`
      }
    });
  }
  return res;
}
var fetchGoogleApi = googleApiFetch;

class GwsClientImpl {
  fetcher;
  constructor(fetcher = fetchGoogleApi) {
    this.fetcher = fetcher;
  }
  async batchUpdate(documentId, requests, opts = {}) {
    const body = { requests };
    if (opts.requiredRevisionId) {
      body.writeControl = { requiredRevisionId: opts.requiredRevisionId };
    }
    try {
      const url = `${DOCS_BASE_URL}/documents/${encodeURIComponent(documentId)}:batchUpdate`;
      const res = await this.fetcher(url, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, documentId));
      }
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, documentId));
    }
  }
  async createDocument(title) {
    try {
      const url = `${DOCS_BASE_URL}/documents`;
      const res = await this.fetcher(url, {
        body: JSON.stringify({ title }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text));
      }
      return JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg));
    }
  }
  async getDocument(documentId) {
    const url = `${DOCS_BASE_URL}/documents/${encodeURIComponent(documentId)}?includeTabsContent=true`;
    try {
      const res = await fetchWithRetry(url, undefined, {
        fetcher: this.fetcher,
        retries: 3
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, documentId));
      }
      return JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, documentId));
    }
  }
  async revisionIdGet(documentId) {
    try {
      const url = `${DOCS_BASE_URL}/documents/${encodeURIComponent(documentId)}?fields=revisionId`;
      const res = await fetchWithRetry(url, undefined, {
        fetcher: this.fetcher,
        retries: 3
      });
      const text = await res.text();
      if (!res.ok)
        return;
      const data = JSON.parse(text);
      return data.revisionId;
    } catch {
      return;
    }
  }
  async run(args) {
    try {
      const res = await execFileAsync2("gws", args);
      return res.stdout;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`gws failed: ${msg}`);
    }
  }
}
var gws = new GwsClientImpl;

class DriveClient {
  fetcher;
  cachedUserDomain;
  constructor(fetcher = fetchGoogleApi) {
    this.fetcher = fetcher;
  }
  async copyFile(fileId, name) {
    try {
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}/copy?supportsAllDrives=true`;
      const res = await this.fetcher(url, {
        body: JSON.stringify({ name }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, fileId));
      }
      return JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }
  async createPermission(fileId, permission, options) {
    try {
      const q = new URLSearchParams({
        fields: "id,displayName,emailAddress,domain,role,type",
        supportsAllDrives: "true"
      });
      if (options?.emailMessage)
        q.set("emailMessage", options.emailMessage);
      if (options?.moveToNewOwnersRoot != null)
        q.set("moveToNewOwnersRoot", String(options.moveToNewOwnersRoot));
      if (options?.sendNotificationEmail != null)
        q.set("sendNotificationEmail", String(options.sendNotificationEmail));
      if (options?.transferOwnership != null)
        q.set("transferOwnership", String(options.transferOwnership));
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}/permissions?${q.toString()}`;
      const body = {
        role: permission.role,
        type: permission.type === "internal" ? "domain" : permission.type
      };
      if (permission.emailAddress)
        body.emailAddress = permission.emailAddress;
      if (permission.domain)
        body.domain = permission.domain;
      const res = await this.fetcher(url, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, fileId));
      }
      return JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }
  async deleteFile(fileId) {
    try {
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`;
      const res = await this.fetcher(url, {
        method: "DELETE"
      });
      if (!res.ok && res.status !== 204) {
        const text = await res.text();
        throw new Error(formatGwsError(text, fileId));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }
  async deletePermission(fileId, permissionId) {
    try {
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`;
      const res = await this.fetcher(url, {
        method: "DELETE"
      });
      if (!res.ok && res.status !== 204) {
        const text = await res.text();
        throw new Error(formatGwsError(text, fileId));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }
  async getFile(fileId, fields = "id,name,mimeType,trashed") {
    try {
      const q = new URLSearchParams({
        fields,
        supportsAllDrives: "true"
      });
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}?${q.toString()}`;
      const res = await this.fetcher(url);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, fileId));
      }
      return JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }
  async getHeadRevisionId(fileId) {
    return this.headRevisionIdGet(fileId);
  }
  async headRevisionIdGet(fileId) {
    try {
      const q = new URLSearchParams({
        fields: "headRevisionId",
        supportsAllDrives: "true"
      });
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}?${q.toString()}`;
      const res = await fetchWithRetry(url, undefined, {
        fetcher: this.fetcher,
        retries: 3
      });
      const text = await res.text();
      if (!res.ok)
        return;
      const data = JSON.parse(text);
      return data.headRevisionId;
    } catch {
      return;
    }
  }
  async listPermissions(fileId, fields = "permissions(id,displayName,emailAddress,domain,role,type)") {
    try {
      const q = new URLSearchParams({
        fields,
        pageSize: "100",
        supportsAllDrives: "true"
      });
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}/permissions?${q.toString()}`;
      const res = await this.fetcher(url);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, fileId));
      }
      const data = JSON.parse(text);
      return data.permissions ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }
  async updateFile(fileId, body) {
    try {
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`;
      const res = await this.fetcher(url, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, fileId));
      }
      return JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }
  async userDomainGet() {
    if (this.cachedUserDomain) {
      return this.cachedUserDomain;
    }
    try {
      const url = `${DRIVE_BASE_URL}/about?fields=user`;
      const res = await this.fetcher(url);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text));
      }
      const data = JSON.parse(text);
      const email = data.user?.emailAddress;
      const domain = email?.split("@")[1];
      if (!domain || domain.toLowerCase() === "gmail.com" || domain.toLowerCase() === "googlemail.com") {
        throw new Error(`Cannot auto-detect workspace domain from personal account "${email ?? "unknown"}". Specify domain: "<domain>".`);
      }
      this.cachedUserDomain = domain;
      return domain;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg));
    }
  }
}
var gwsDrive = new DriveClient;

// src/core/tabs.ts
var URL_NOT_ACCEPTED_MSG = `Pass the document ID, not the full URL.

Google Docs URL structure:
  https://docs.google.com/document/d/<documentId>/edit?tab=<tabId>
                                    ^^^^^^^^^^^^        ^^^^^^
                                    Document ID         --tab <tabId>

Example:
  doc query 1aMO6FtA-XVE6QtDEDGYgbd4NAg1mAT0LJKsjQvazouE --tab t.5up1ytauvsxg`;
var TAB_REQUIRED_MSG = "This Doc has multiple tabs. Specify --tab <id|title>.";
var APPLY_TAB_REQUIRED_MSG = "This Doc has multiple tabs. Each tabs[] entry must include tabId from query or tab list.";
function relativeTabIndexResolve(data, opts) {
  if (opts.afterTab && opts.beforeTab) {
    throw new Error('Cannot specify both "afterTab" and "beforeTab"');
  }
  if ((opts.afterTab || opts.beforeTab) && opts.index != null) {
    throw new Error('Cannot specify both "index" and "afterTab"/"beforeTab"');
  }
  if (!opts.afterTab && !opts.beforeTab) {
    return opts.index;
  }
  const hint = opts.afterTab ?? opts.beforeTab;
  const resolved = tabResolve(data, hint);
  const flat = data.tabs?.length ? tabsFlatten(data.tabs) : [{ tabId: "t.0", title: "Main" }];
  const candidateTabs = opts.movingTabId ? flat.filter((t) => t.tabId !== opts.movingTabId) : flat;
  const targetIndex = candidateTabs.findIndex((t) => t.tabId === resolved.tabId);
  if (targetIndex < 0) {
    throw new Error(`Tab "${hint}" not found in document`);
  }
  return opts.afterTab ? targetIndex + 1 : targetIndex;
}
var resolveRelativeTabIndex = relativeTabIndexResolve;
function refParse(input) {
  const trimmed = input.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.includes("/document/d/") || trimmed.includes("?tab=") || trimmed.includes("#tab=")) {
    throw new Error(URL_NOT_ACCEPTED_MSG);
  }
  return { documentId: trimmed };
}
var parseRef = refParse;
function tabsFlatten(tabs) {
  const out = [];
  walkTabs(tabs, (tab) => {
    const tabId = tab.tabProperties?.tabId;
    if (!tabId)
      return;
    out.push({ tabId, title: tab.tabProperties?.title ?? "" });
  });
  return out;
}
var flattenTabs = tabsFlatten;
function tabsWalk(tabs, visit) {
  for (const tab of tabs ?? []) {
    visit(tab);
    tabsWalk(tab.childTabs, visit);
  }
}
var walkTabs = tabsWalk;
function tabTree(tabs, _documentId) {
  return (tabs ?? []).map((tab) => tabToOutline(tab)).filter((t) => t != null);
}
function tabResolve(data, hint) {
  const flat = flattenTabs(data.tabs);
  if (!flat.length) {
    if (hint && hint !== "t.0" && hint.toLowerCase() !== "main" && hint.toLowerCase() !== "document") {
      throw new Error(`This Doc has no tabs; cannot use tab ${hint}.`);
    }
    return { tabId: "t.0", title: data.title || "Main" };
  }
  if (hint)
    return pickTab(flat, hint);
  if (flat.length === 1) {
    return { tabId: flat[0]?.tabId, title: flat[0]?.title };
  }
  throw tabRequiredError(tabTree(data.tabs));
}
var resolveTab = tabResolve;
function tabOverlay(data, tabId) {
  const dt = tabContent(data, tabId);
  return {
    ...data,
    body: dt.body ?? { content: [] },
    documentStyle: dt.documentStyle ?? data.documentStyle,
    footnotes: dt.footnotes,
    footers: dt.footers,
    headers: dt.headers,
    inlineObjects: dt.inlineObjects,
    lists: dt.lists
  };
}
var overlayTab = tabOverlay;
function applyTabResolve(data, fileTabId, hint) {
  const flat = flattenTabs(data.tabs);
  if (fileTabId) {
    const file = resolveTab(data, fileTabId);
    if (hint) {
      const fromHint = resolveTab(data, hint);
      if (fromHint.tabId && file.tabId && fromHint.tabId !== file.tabId) {
        throw new Error(`File tabId ${file.tabId} does not match --tab ${fromHint.tabId}.`);
      }
    }
    return file;
  }
  if (flat.length > 1) {
    throw new Error(`${APPLY_TAB_REQUIRED_MSG}
${JSON.stringify({ tabs: tabTree(data.tabs) }, null, 2)}`);
  }
  return resolveTab(data, hint);
}
var resolveApplyTab = applyTabResolve;
function tabContent(data, tabId) {
  const tab = findTab(data.tabs, tabId);
  if (!tab) {
    const known = flattenTabs(data.tabs).map((t) => t.tabId).join(", ");
    throw new Error(`Unknown tab ${tabId}.${known ? ` Known: ${known}` : ""}`);
  }
  return tab.documentTab ?? {};
}
function tabFind(tabs, tabId) {
  let hit;
  walkTabs(tabs, (tab) => {
    if (tab.tabProperties?.tabId === tabId)
      hit = tab;
  });
  return hit;
}
var findTab = tabFind;
function tabRequiredError(tabs) {
  return new Error(`${TAB_REQUIRED_MSG}
${JSON.stringify({ tabs }, null, 2)}`);
}
function pickTab(flat, hint) {
  const byId = flat.find((t) => t.tabId === hint);
  if (byId)
    return byId;
  const needle = hint.trim().toLowerCase();
  const byTitle = flat.filter((t) => t.title.trim().toLowerCase() === needle);
  if (byTitle.length === 1)
    return byTitle[0];
  if (byTitle.length > 1) {
    throw new Error(`Ambiguous tab title "${hint}". Use the tab id from tab list.`);
  }
  if ((needle === "t.0" || needle === "0" || needle === "root") && flat.length > 0) {
    return flat[0];
  }
  const known = flat.map((t) => `${t.tabId} (${t.title || "untitled"})`).join(", ");
  throw new Error(`Unknown tab ${hint}.${known ? ` Known: ${known}` : ""}`);
}
function tabToOutline(tab) {
  const tabId = tab.tabProperties?.tabId;
  if (!tabId)
    return;
  const row = {
    tabId,
    title: tab.tabProperties?.title ?? ""
  };
  const children = (tab.childTabs ?? []).map((c) => tabToOutline(c)).filter((t) => t != null);
  if (children.length)
    row.children = children;
  return row;
}

// src/core/gdoc.ts
class Gdoc {
  data;
  id;
  tabId;
  constructor(data, id, tabId) {
    this.data = data;
    this.id = id;
    this.tabId = tabId;
  }
  static async load(id, client = gws, options) {
    return docCache.get(id, client, options);
  }
  static idParse(input) {
    return parseRef(input).documentId;
  }
  static parseId(input) {
    return Gdoc.idParse(input);
  }
  static refParse(input) {
    return parseRef(input);
  }
  static parseRef(input) {
    return Gdoc.refParse(input);
  }
  withTab(tabId) {
    return new Gdoc(overlayTab(this.data, tabId), this.id, tabId);
  }
  tableAtFind(index) {
    const tables = (this.data.body?.content ?? []).filter((el) => el.table);
    return tables.find((el) => el.startIndex === index) ?? tables.find((el) => el.startIndex >= index && el.startIndex <= index + 3) ?? tables.find((el) => el.startIndex <= index && el.endIndex > index);
  }
  findTableAt(index) {
    return this.tableAtFind(index);
  }
  insertedTableAtFind(index) {
    const tables = (this.data.body?.content ?? []).filter((el) => el.table);
    return tables.find((el) => el.startIndex === index) ?? tables.filter((el) => el.startIndex >= index && el.startIndex <= index + 5).sort((a, b) => a.startIndex - b.startIndex)[0];
  }
  findInsertedTableAt(index) {
    return this.insertedTableAtFind(index);
  }
}

// src/core/cache/sqlite.ts
import { mkdirSync as mkdirSync10 } from "node:fs";
import { dirname as dirname6 } from "node:path";
var isBun = typeof process.versions.bun !== "undefined";
var sqliteModule = isBun ? await import("bun:sqlite") : await import("node:sqlite");

class SqliteDatabase {
  db;
  constructor(dbPath = cacheDbPath()) {
    if (dbPath !== ":memory:") {
      mkdirSync10(dirname6(dbPath), { recursive: true });
    }
    this.db = isBun ? new sqliteModule.Database(dbPath) : new sqliteModule.DatabaseSync(dbPath);
    if (dbPath !== ":memory:") {
      try {
        this.db.exec("PRAGMA journal_mode = WAL;");
      } catch {}
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS doc_snapshots (
        data_json TEXT NOT NULL,
        doc_id TEXT PRIMARY KEY,
        fetched_at INTEGER NOT NULL,
        revision_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_doc_snapshots_fetched_at ON doc_snapshots(fetched_at);
    `);
  }
  close() {
    this.db.close();
  }
  clear() {
    this.db.exec("DELETE FROM doc_snapshots;");
  }
  delete(docId) {
    this.db.prepare("DELETE FROM doc_snapshots WHERE doc_id = ?;").run(docId);
  }
  exec(sql) {
    this.db.exec(sql);
  }
  get(docId) {
    const row = this.db.prepare("SELECT data_json, doc_id, fetched_at, revision_id FROM doc_snapshots WHERE doc_id = ?;").get(docId);
    if (!row || typeof row !== "object")
      return;
    return row;
  }
  prune(olderThanMs) {
    const cutoff = Date.now() - olderThanMs;
    this.db.prepare("DELETE FROM doc_snapshots WHERE fetched_at < ?;").run(cutoff);
  }
  set(docId, revisionId, dataJson, fetchedAt = Date.now()) {
    this.db.prepare(`
        INSERT INTO doc_snapshots (data_json, doc_id, fetched_at, revision_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(doc_id) DO UPDATE SET
          data_json = excluded.data_json,
          fetched_at = excluded.fetched_at,
          revision_id = excluded.revision_id;
      `).run(dataJson, docId, fetchedAt, revisionId);
  }
  touch(docId, fetchedAt = Date.now()) {
    this.db.prepare("UPDATE doc_snapshots SET fetched_at = ? WHERE doc_id = ?;").run(fetchedAt, docId);
  }
}

// src/core/cache/docCache.ts
var DEFAULT_TTL1_MS = 1e4;
var DEFAULT_TTL2_MS = 300000;
var DEFAULT_SQLITE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

class DocCache {
  db;
  inFlight = new Map;
  memoryCache = new Map;
  ttl1Ms;
  ttl2Ms;
  constructor(options = {}) {
    this.db = options.db ?? new SqliteDatabase;
    this.ttl1Ms = options.ttl1Ms ?? DEFAULT_TTL1_MS;
    this.ttl2Ms = options.ttl2Ms ?? DEFAULT_TTL2_MS;
    try {
      this.db.prune(DEFAULT_SQLITE_RETENTION_MS);
    } catch {}
  }
  clear() {
    this.memoryCache.clear();
    this.inFlight.clear();
    this.db.clear();
  }
  async get(docId, client = gws, options) {
    if (options?.noCache) {
      const data = await client.getDocument(docId);
      return new Gdoc(data, docId);
    }
    if (options?.forceFetch) {
      return this.fetchAndStore(docId, client);
    }
    const now = Date.now();
    const memEntry = this.memoryCache.get(docId);
    if (memEntry) {
      const age = now - memEntry.fetchedAt;
      if (age < this.ttl1Ms) {
        return new Gdoc(structuredClone(memEntry.gdoc.data), docId);
      }
      if (age < this.ttl2Ms) {
        this.revalidateInBackground(docId, client, memEntry);
        return new Gdoc(structuredClone(memEntry.gdoc.data), docId);
      }
      return this.hardValidateOrRefresh(docId, client, memEntry);
    }
    const stored = this.db.get(docId);
    if (stored) {
      try {
        const docData = JSON.parse(stored.data_json);
        const gdoc = new Gdoc(docData, docId);
        const entry = {
          fetchedAt: stored.fetched_at,
          gdoc
        };
        this.memoryCache.set(docId, entry);
        const age = now - entry.fetchedAt;
        if (age < this.ttl1Ms) {
          return new Gdoc(docData, docId);
        }
        if (age < this.ttl2Ms) {
          this.revalidateInBackground(docId, client, entry);
          return new Gdoc(docData, docId);
        }
        return this.hardValidateOrRefresh(docId, client, entry);
      } catch {}
    }
    return this.fetchAndStore(docId, client);
  }
  invalidate(docId) {
    this.memoryCache.delete(docId);
    this.inFlight.delete(docId);
    this.db.delete(docId);
  }
  reap() {
    const now = Date.now();
    for (const [docId, entry] of this.memoryCache.entries()) {
      if (now - entry.fetchedAt >= this.ttl2Ms) {
        this.memoryCache.delete(docId);
      }
    }
  }
  set(docId, gdoc) {
    const now = Date.now();
    const revId = gdoc.data.revisionId ?? "";
    this.db.set(docId, revId, JSON.stringify(gdoc.data), now);
    this.memoryCache.set(docId, {
      fetchedAt: now,
      gdoc: new Gdoc(structuredClone(gdoc.data), docId)
    });
  }
  async fetchAndStore(docId, client) {
    const existingPromise = this.inFlight.get(docId);
    if (existingPromise) {
      return existingPromise;
    }
    const fetchPromise = (async () => {
      const data = await client.getDocument(docId);
      const now = Date.now();
      const revId = data.revisionId ?? "";
      this.db.set(docId, revId, JSON.stringify(data), now);
      this.memoryCache.set(docId, {
        fetchedAt: now,
        gdoc: new Gdoc(structuredClone(data), docId)
      });
      return new Gdoc(structuredClone(data), docId);
    })();
    this.inFlight.set(docId, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.inFlight.delete(docId);
    }
  }
  async hardValidateOrRefresh(docId, client, entry) {
    try {
      const cloudRev = await cloudRevisionIdGet(docId, client);
      if (cloudRev && cloudRev === entry.gdoc.data.revisionId) {
        const now = Date.now();
        entry.fetchedAt = now;
        this.db.touch(docId, now);
        return new Gdoc(structuredClone(entry.gdoc.data), docId);
      }
    } catch {}
    return this.fetchAndStore(docId, client);
  }
  revalidateInBackground(docId, client, entry) {
    if (this.inFlight.has(docId))
      return;
    const task = (async () => {
      try {
        const cloudRev = await cloudRevisionIdGet(docId, client);
        if (cloudRev && cloudRev === entry.gdoc.data.revisionId) {
          const now = Date.now();
          entry.fetchedAt = now;
          this.db.touch(docId, now);
        } else {
          await this.fetchAndStore(docId, client);
        }
      } catch {}
    })();
    task.catch(() => {});
  }
}
async function cloudRevisionIdGet(docId, client) {
  return client.revisionIdGet?.(docId);
}
var docCache = new DocCache;

// node_modules/marked/lib/marked.esm.js
function A() {
  return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
}
var T = A();
function U(l) {
  T = l;
}
var E = { exec: () => null };
function I(l) {
  let e = [];
  return (t) => {
    let n = Math.max(0, Math.min(3, t - 1)), i = e[n];
    return i || (i = l(n), e[n] = i), i;
  };
}
function d(l, e = "") {
  let t = typeof l == "string" ? l : l.source, n = { replace: (i, r) => {
    let o = typeof r == "string" ? r : r.source;
    return o = o.replace(m.caret, "$1"), t = t.replace(i, o), n;
  }, getRegex: () => new RegExp(t, e) };
  return n;
}
var we = ((l = "") => {
  try {
    return !!new RegExp("(?<=1)(?<!1)" + l);
  } catch {
    return false;
  }
})();
var m = { codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, endingSpaceTabChar: /[ \t]$/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] +\S/, listReplaceTask: /^\[[ xX]\] +/, listTaskCheckbox: /\[[ xX]\]/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (l) => new RegExp(`^( {0,3}${l})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: I((l) => new RegExp(`^ {0,${l}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)), hrRegex: I((l) => new RegExp(`^ {0,${l}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\\*[ 	]*){3,})(?:\\n+|$)`)), fencesBeginRegex: I((l) => new RegExp(`^ {0,${l}}(?:\`\`\`|~~~)`)), headingBeginRegex: I((l) => new RegExp(`^ {0,${l}}#`)), htmlBeginRegex: I((l) => new RegExp(`^ {0,${l}}(?:</?(?:${H})(?: +|$|/?>)|<(?:script|pre|style|textarea|!--))`, "i")), blockquoteBeginRegex: I((l) => new RegExp(`^ {0,${l}}>`)) };
var ye = /^(?:[ \t]*(?:\n|$))+/;
var Pe = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var Se = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var v = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var _e = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var K = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
var le = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
var ue = d(le).replace(/bull/g, K).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
var $e = d(le).replace(/bull/g, K).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
var W = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
var Le = /^[^\n]+/;
var X = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
var ze = d(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", X).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var Ee = d(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, K).getRegex();
var H = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var J = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var Me = d("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$))", "i").replace("comment", J).replace("tag", H).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var pe = (l) => d(W).replace("hr", v).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", l).replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", H).getRegex();
var Ae = pe(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
var Ie = pe(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
var Ce = d(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", Ie).getRegex();
var V = { blockquote: Ce, code: Pe, def: ze, fences: Se, heading: _e, hr: v, html: Me, lheading: ue, list: Ee, newline: ye, paragraph: Ae, table: E, text: Le };
var ie = d("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", v).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}\t)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", H).getRegex();
var Be = { ...V, lheading: $e, table: ie, paragraph: d(W).replace("hr", v).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", ie).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", H).getRegex() };
var De = { ...V, html: d(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", J).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: E, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: d(W).replace("hr", v).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", ue).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
var qe = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var ve = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var ce = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
var He = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var _ = /[\p{P}\p{S}]/u;
var C = /[\s\p{P}\p{S}]/u;
var Z = /[^\s\p{P}\p{S}]/u;
var Ze = d(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, C).getRegex();
var Ge = /[\p{Pi}\p{Ps}"']/u;
var he = /(?!~)[\p{P}\p{S}]/u;
var Qe = /(?!~)[\s\p{P}\p{S}]/u;
var Ne = /(?:[^\s\p{P}\p{S}]|~)/u;
var je = d(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", we ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var de = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
var Ue = d(de, "u").replace(/punct/g, _).getRegex();
var Fe = d(de, "u").replace(/punct/g, he).getRegex();
var Ke = /^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/;
var We = d(Ke, "u").replace(/openQuote/g, Ge).replace(/punct/g, _).getRegex();
var ke = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var Xe = d(ke, "gu").replace(/notPunctSpace/g, Z).replace(/punctSpace/g, C).replace(/punct/g, _).getRegex();
var Je = d(ke, "gu").replace(/notPunctSpace/g, Ne).replace(/punctSpace/g, Qe).replace(/punct/g, he).getRegex();
var Ve = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)";
var Ye = d(Ve, "gu").replace(/notPunctSpace/g, Z).replace(/punctSpace/g, C).replace(/punct/g, _).getRegex();
var et = d("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, Z).replace(/punctSpace/g, C).replace(/punct/g, _).getRegex();
var tt = "^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)";
var nt = d(tt, "gu").replace(/notPunctSpace/g, Z).replace(/punctSpace/g, C).replace(/punct/g, _).getRegex();
var rt = d(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, _).getRegex();
var st = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
var it = d(st, "gu").replace(/notPunctSpace/g, Z).replace(/punctSpace/g, C).replace(/punct/g, _).getRegex();
var ot = d(/\\(punct)/, "gu").replace(/punct/g, _).getRegex();
var at = d(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var lt = d(J).replace("(?:-->|$)", "-->").getRegex();
var ut = d("^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", lt).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var ge = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
var N = d(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace("brackets", ge).getRegex();
var pt = d(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?\s*\)/).replace("label", N).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var ct = d(/^!?\[(label)\]\[(ref)\]/).replace("label", N).replace("ref", X).getRegex();
var ht = d(/^!?\[(ref)\](?:\[\])?/).replace("ref", X).getRegex();
var oe = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
var dt = d(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace("brackets", ge).getRegex();
var kt = d("reflink|nolink(?!\\()", "g").replace("reflink", d(/^!?\[(label)\]\[(ref)\]/).replace("label", dt).replace("ref", oe).getRegex()).replace("nolink", d(/^!?\[(ref)\](?:\[\])?/).replace("ref", oe).getRegex()).getRegex();
var ae = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var Y = { _backpedal: E, anyPunctuation: ot, autolink: at, blockSkip: je, br: ce, code: ve, del: E, delLDelim: E, delRDelim: E, emStrongLDelim: Ue, emStrongRDelimAst: Xe, emStrongRDelimUnd: et, escape: qe, link: pt, nolink: ht, punctuation: Ze, reflink: ct, reflinkSearch: kt, tag: ut, text: He, url: E };
var gt = { ...Y, emStrongLDelim: We, emStrongRDelimAst: Ye, emStrongRDelimUnd: nt, link: d(/^!?\[(label)\]\((.*?)\)/).replace("label", N).getRegex(), reflink: d(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", N).getRegex() };
var F = { ...Y, emStrongRDelimAst: Je, emStrongLDelim: Fe, delLDelim: rt, delRDelim: it, url: d(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol", ae).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: d(/^(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol", ae).getRegex() };
var ft = { ...F, br: d(ce).replace("{2,}", "*").getRegex(), text: d(F.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() };
var G = { normal: V, gfm: Be, pedantic: De };
var B = { normal: Y, gfm: F, breaks: ft, pedantic: gt };
var mt = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var fe = (l) => mt[l];
function R(l, e) {
  if (e) {
    if (m.escapeTest.test(l))
      return l.replace(m.escapeReplace, fe);
  } else if (m.escapeTestNoEncode.test(l))
    return l.replace(m.escapeReplaceNoEncode, fe);
  return l;
}
function ee(l) {
  try {
    l = encodeURI(l).replace(m.percentDecode, "%");
  } catch {
    return null;
  }
  return l;
}
function te(l, e) {
  let t = l.replace(m.findPipe, (r, o, s) => {
    let u = false, a = o;
    for (;--a >= 0 && s[a] === "\\"; )
      u = !u;
    return u ? "|" : " |";
  }), n = t.split(m.splitPipe), i = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e)
    if (n.length > e)
      n.splice(e);
    else
      for (;n.length < e; )
        n.push("");
  for (;i < n.length; i++)
    n[i] = n[i].trim().replace(m.slashPipe, "|");
  return n;
}
function $(l, e, t) {
  let n = l.length;
  if (n === 0)
    return "";
  let i = 0;
  for (;i < n; ) {
    let r = l.charAt(n - i - 1);
    if (r === e && !t)
      i++;
    else if (r !== e && t)
      i++;
    else
      break;
  }
  return l.slice(0, n - i);
}
function ne(l) {
  let e = l.split(`
`), t = e.length - 1;
  for (;t >= 0 && m.blankLine.test(e[t]); )
    t--;
  return e.length - t <= 2 ? l : e.slice(0, t + 1).join(`
`);
}
function D(l) {
  return l.toLowerCase().toUpperCase().toLowerCase();
}
function me(l, e) {
  if (l.indexOf(e[1]) === -1)
    return -1;
  let t = 0;
  for (let n = 0;n < l.length; n++)
    if (l[n] === "\\")
      n++;
    else if (l[n] === e[0])
      t++;
    else if (l[n] === e[1] && (t--, t < 0))
      return n;
  return t > 0 ? -2 : -1;
}
function xe(l, e = 0) {
  let t = e, n = "";
  for (let i of l)
    if (i === "\t") {
      let r = 4 - t % 4;
      n += " ".repeat(r), t += r;
    } else
      n += i, t++;
  return n;
}
function be(l, e, t, n, i) {
  let r = e.href, o = e.title || null, s = l[1].replace(i.other.outputLinkReplace, "$1"), u = l[0].charAt(0) === "!";
  n.state.inLink = true;
  let a = n.state.linkEmitted, p = n.state.inRawBlock;
  n.state.linkEmitted = false;
  let c = n.inlineTokens(s), h = n.state.linkEmitted;
  if (n.state.linkEmitted = a, n.state.inLink = false, !u) {
    if (h) {
      n.state.inRawBlock = p;
      return;
    }
    n.state.linkEmitted = true;
  }
  return { type: u ? "image" : "link", raw: t, href: r, title: o, text: s, tokens: c };
}
function xt(l, e, t) {
  let n = l.match(t.other.indentCodeCompensation);
  if (n === null)
    return e;
  let i = n[1];
  return e.split(`
`).map((r) => {
    let o = r.match(t.other.beginningSpace);
    if (o === null)
      return r;
    let [s] = o;
    return r.slice(Math.min(s.length, i.length));
  }).join(`
`);
}
function Re(l, e, t, n) {
  if (!e.includes("<"))
    return false;
  for (let i = 0;i < e.length; i++) {
    if (e[i] === "\\") {
      i++;
      continue;
    }
    if (e[i] === "`") {
      let s = n.inline.code.exec(e.slice(i));
      if (s) {
        i += s[0].length - 1;
        continue;
      }
    }
    if (e[i] !== "<")
      continue;
    let r = l.slice(t + i), o = n.inline.tag.exec(r) || n.inline.autolink.exec(r);
    if (o) {
      if (o[0].length > e.length - i)
        return true;
      i += o[0].length - 1;
    }
  }
  return false;
}
var y = class {
  options;
  rules;
  lexer;
  constructor(e) {
    this.options = e || T;
  }
  space(e) {
    let t = this.rules.block.newline.exec(e);
    if (t && t[0].length > 0)
      return { type: "space", raw: t[0] };
  }
  code(e) {
    let t = this.rules.block.code.exec(e);
    if (t) {
      let n = this.options.pedantic ? t[0] : ne(t[0]), i = n.replace(this.rules.other.codeRemoveIndent, "");
      return { type: "code", raw: n, codeBlockStyle: "indented", text: i };
    }
  }
  fences(e) {
    let t = this.rules.block.fences.exec(e);
    if (t) {
      let n = t[0], i = xt(n, t[3] || "", this.rules);
      return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: i };
    }
  }
  heading(e) {
    let t = this.rules.block.heading.exec(e);
    if (t) {
      let n = t[2].trim();
      if (this.rules.other.endingHash.test(n)) {
        let i = $(n, "#");
        (this.options.pedantic || !i || this.rules.other.endingSpaceTabChar.test(i)) && (n = i.trim());
      }
      return { type: "heading", raw: $(t[0], `
`), depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
    }
  }
  hr(e) {
    let t = this.rules.block.hr.exec(e);
    if (t)
      return { type: "hr", raw: $(t[0], `
`) };
  }
  blockquote(e) {
    let t = this.rules.block.blockquote.exec(e);
    if (t) {
      let n = $(t[0], `
`).split(`
`), i = "", r = "", o = [];
      for (;n.length > 0; ) {
        let s = false, u = [], a;
        for (a = 0;a < n.length; a++)
          if (this.rules.other.blockquoteStart.test(n[a]))
            u.push(n[a]), s = true;
          else if (!s)
            u.push(n[a]);
          else
            break;
        n = n.slice(a);
        let p = u.join(`
`), c = p.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
        i = i ? `${i}
${p}` : p, r = r ? `${r}
${c}` : c;
        let h = this.lexer.state.top;
        if (this.lexer.state.top = true, this.lexer.blockTokens(c, o, true), this.lexer.state.top = h, n.length === 0)
          break;
        let k = o.at(-1);
        if (k?.type === "code")
          break;
        if (k?.type === "blockquote") {
          let O = k, g = n.join(`
`), w = O.raw + `
` + g.replace(this.rules.other.blockquoteSetextReplace2, ""), z = this.blockquote(w);
          o[o.length - 1] = z, i = `${i}
${g}`, r = r.substring(0, r.length - O.text.length) + z.text;
          break;
        } else if (k?.type === "list") {
          let O = k, g = O.raw + `
` + n.join(`
`), w = this.list(g);
          o[o.length - 1] = w, i = i.substring(0, i.length - k.raw.length) + w.raw, r = r.substring(0, r.length - O.raw.length) + w.raw, n = g.substring(o.at(-1).raw.length).split(`
`);
          continue;
        }
      }
      return { type: "blockquote", raw: i, tokens: o, text: r };
    }
  }
  list(e) {
    let t = this.rules.block.list.exec(e);
    if (t) {
      let n = t[1].trim(), i = n.length > 1, r = { type: "list", raw: "", ordered: i, start: i ? +n.slice(0, -1) : "", loose: false, items: [] };
      n = i ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = i ? n : "[*+-]");
      let o = this.rules.other.listItemRegex(n), s = false;
      for (;e; ) {
        let a = false, p = "", c = "";
        if (!(t = o.exec(e)) || this.rules.block.hr.test(e))
          break;
        p = t[0], e = e.substring(p.length);
        let h = xe(t[2].split(`
`, 1)[0], t[1].length), k = e.split(`
`, 1)[0], O = !h.trim(), g = 0;
        if (this.options.pedantic ? (g = 2, c = h.trimStart()) : O ? g = t[1].length + 1 : (g = h.search(this.rules.other.nonSpaceChar), g = g > 4 ? 1 : g, c = h.slice(g), g += t[1].length), O && this.rules.other.blankLine.test(k) && (p += k + `
`, e = e.substring(k.length + 1), a = true), !a) {
          let w = this.rules.other.nextBulletRegex(g), z = this.rules.other.hrRegex(g), re = this.rules.other.fencesBeginRegex(g), se = this.rules.other.headingBeginRegex(g), Te = this.rules.other.htmlBeginRegex(g), Oe = this.rules.other.blockquoteBeginRegex(g);
          for (;e; ) {
            let j = e.split(`
`, 1)[0], q;
            if (k = j, this.options.pedantic ? (k = k.replace(this.rules.other.listReplaceNesting, "  "), q = k) : q = k.replace(this.rules.other.tabCharGlobal, "    "), re.test(k) || se.test(k) || Te.test(k) || Oe.test(k) || w.test(k) || z.test(k))
              break;
            if (q.search(this.rules.other.nonSpaceChar) >= g || !k.trim())
              c += `
` + q.slice(g);
            else {
              if (O || h.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || re.test(h) || se.test(h) || z.test(h))
                break;
              c += `
` + k;
            }
            O = !k.trim(), p += j + `
`, e = e.substring(j.length + 1), h = q.slice(g);
          }
        }
        r.loose || (s ? r.loose = true : this.rules.other.doubleBlankLine.test(p) && (s = true)), r.items.push({ type: "list_item", raw: p, task: !!this.options.gfm && this.rules.other.listIsTask.test(c), loose: false, text: c, tokens: [] }), r.raw += p;
      }
      let u = r.items.at(-1);
      if (u)
        u.raw = u.raw.trimEnd(), u.text = u.text.trimEnd();
      else
        return;
      r.raw = r.raw.trimEnd();
      for (let a of r.items)
        if (this.lexer.state.top = false, a.tokens = this.lexer.blockTokens(a.text, []), !r.loose) {
          let p = a.tokens.filter((h) => h.type === "space"), c = p.length > 0 && p.some((h) => this.rules.other.anyLine.test(h.raw));
          r.loose = c;
        }
      for (let a of r.items) {
        let p = a.tokens[0];
        if (a.task && (p?.type === "text" || p?.type === "paragraph")) {
          a.text = a.text.replace(this.rules.other.listReplaceTask, ""), p.raw = p.raw.replace(this.rules.other.listReplaceTask, ""), p.text = p.text.replace(this.rules.other.listReplaceTask, "");
          for (let h = this.lexer.inlineQueue.length - 1;h >= 0; h--)
            if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[h].src)) {
              this.lexer.inlineQueue[h].src = this.lexer.inlineQueue[h].src.replace(this.rules.other.listReplaceTask, "");
              break;
            }
          let c = this.rules.other.listTaskCheckbox.exec(a.raw);
          if (c) {
            let h = { type: "checkbox", raw: c[0] + " ", checked: c[0] !== "[ ]" };
            a.checked = h.checked, r.loose ? a.tokens[0] && ["paragraph", "text"].includes(a.tokens[0].type) && "tokens" in a.tokens[0] && a.tokens[0].tokens ? (a.tokens[0].raw = h.raw + a.tokens[0].raw, a.tokens[0].text = h.raw + a.tokens[0].text, a.tokens[0].tokens.unshift(h)) : a.tokens.unshift({ type: "paragraph", raw: h.raw, text: h.raw, tokens: [h] }) : a.tokens.unshift(h);
          }
        } else
          a.task && (a.task = false);
      }
      if (r.loose)
        for (let a of r.items) {
          a.loose = true;
          for (let p of a.tokens)
            p.type === "text" && (p.type = "paragraph");
        }
      return r;
    }
  }
  html(e) {
    let t = this.rules.block.html.exec(e);
    if (t) {
      let n = ne(t[0]);
      return { type: "html", block: true, raw: n, pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: n };
    }
  }
  def(e) {
    let t = this.rules.block.def.exec(e);
    if (t) {
      let n = D(t[1]).replace(this.rules.other.multipleSpaceGlobal, " "), i = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
      return { type: "def", tag: n, raw: $(t[0], `
`), href: i, title: r };
    }
  }
  table(e) {
    let t = this.rules.block.table.exec(e);
    if (!t || !this.rules.other.tableDelimiter.test(t[2]))
      return;
    let n = te(t[1]), i = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], o = { type: "table", raw: $(t[0], `
`), header: [], align: [], rows: [] };
    if (n.length === i.length) {
      for (let s of i)
        this.rules.other.tableAlignRight.test(s) ? o.align.push("right") : this.rules.other.tableAlignCenter.test(s) ? o.align.push("center") : this.rules.other.tableAlignLeft.test(s) ? o.align.push("left") : o.align.push(null);
      for (let s = 0;s < n.length; s++)
        o.header.push({ text: n[s], tokens: this.lexer.inline(n[s]), header: true, align: o.align[s] });
      for (let s of r)
        o.rows.push(te(s, o.header.length).map((u, a) => ({ text: u, tokens: this.lexer.inline(u), header: false, align: o.align[a] })));
      return o;
    }
  }
  lheading(e) {
    let t = this.rules.block.lheading.exec(e);
    if (t) {
      let n = t[1].trim();
      return { type: "heading", raw: $(t[0], `
`), depth: t[2].charAt(0) === "=" ? 1 : 2, text: n, tokens: this.lexer.inline(n) };
    }
  }
  paragraph(e) {
    let t = this.rules.block.paragraph.exec(e);
    if (t) {
      let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
      return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
    }
  }
  text(e) {
    let t = this.rules.block.text.exec(e);
    if (t)
      return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
  }
  escape(e) {
    let t = this.rules.inline.escape.exec(e);
    if (t)
      return { type: "escape", raw: t[0], text: t[1] };
  }
  tag(e) {
    let t = this.rules.inline.tag.exec(e);
    if (t)
      return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
  }
  link(e) {
    let t = this.rules.inline.link.exec(e);
    if (t) {
      let n = t[0].charAt(0) === "!" ? 2 : 1;
      if (!this.options.pedantic && Re(e, t[1], n, this.rules))
        return;
      let i = t[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(i)) {
        if (!this.rules.other.endAngleBracket.test(i))
          return;
        let s = $(i.slice(0, -1), "\\");
        if ((i.length - s.length) % 2 === 0)
          return;
      } else {
        let s = me(t[2], "()");
        if (s === -2)
          return;
        if (s > -1) {
          let a = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + s;
          t[2] = t[2].substring(0, s), t[0] = t[0].substring(0, a).trim(), t[3] = "";
        }
      }
      let r = t[2], o = "";
      if (this.options.pedantic) {
        let s = this.rules.other.pedanticHrefTitle.exec(r);
        s && (r = s[1], o = s[3]);
      } else
        o = t[3] ? t[3].slice(1, -1) : "";
      return r = r.trim(), this.rules.other.startAngleBracket.test(r) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(i) ? r = r.slice(1) : r = r.slice(1, -1)), be(t, { href: r && r.replace(this.rules.inline.anyPunctuation, "$1"), title: o && o.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
    }
  }
  reflink(e, t) {
    let n;
    if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
      let i = n[0].charAt(0) === "!" ? 2 : 1;
      if (!this.options.pedantic && Re(e, n[1], i, this.rules))
        return;
      let r = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), o = t[D(r)];
      if (!o) {
        let s = n[0].charAt(0);
        return { type: "text", raw: s, text: s };
      }
      return be(n, o, n[0], this.lexer, this.rules);
    }
  }
  emStrong(e, t, n = "") {
    let i = this.rules.inline.emStrongLDelim.exec(e);
    if (!i || !i[1] && !i[2] && !i[3] && !i[4] || i[4] && n.match(this.rules.other.unicodeAlphaNumeric))
      return;
    if (!(i[1] || i[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let o = [...i[0]].length - 1, s, u, a = o, p = 0, c = i[0][0], h = n === c, k = c === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      for (k.lastIndex = 0, t = t.slice(-1 * e.length + o);(i = k.exec(t)) !== null; ) {
        if (s = i[1] || i[2] || i[3] || i[4] || i[5] || i[6], !s)
          continue;
        if (u = [...s].length, i[3] || i[4]) {
          a += u;
          continue;
        } else if (i[5] || i[6]) {
          if (o % 3 && !((o + u) % 3)) {
            p += u;
            continue;
          }
          if (h)
            break;
        }
        if (a -= u, a > 0)
          continue;
        u = Math.min(u, u + a + p);
        let O = [...i[0]][0].length, g = e.slice(0, o + i.index + O + u);
        if (Math.min(o, u) % 2) {
          let z = g.slice(1, -1);
          return { type: "em", raw: g, text: z, tokens: this.lexer.inlineTokens(z) };
        }
        let w = g.slice(2, -2);
        return { type: "strong", raw: g, text: w, tokens: this.lexer.inlineTokens(w) };
      }
    }
  }
  codespan(e) {
    let t = this.rules.inline.code.exec(e);
    if (t) {
      let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), i = this.rules.other.nonSpaceChar.test(n), r = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
      return i && r && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
    }
  }
  br(e) {
    let t = this.rules.inline.br.exec(e);
    if (t)
      return { type: "br", raw: t[0] };
  }
  del(e, t, n = "") {
    let i = this.rules.inline.delLDelim.exec(e);
    if (!i)
      return;
    if (!(i[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let o = [...i[0]].length - 1, s, u, a = o, p = this.rules.inline.delRDelim;
      for (p.lastIndex = 0, t = t.slice(-1 * e.length + o);(i = p.exec(t)) !== null; ) {
        if (s = i[1] || i[2] || i[3] || i[4] || i[5] || i[6], !s || (u = [...s].length, u !== o))
          continue;
        if (i[3] || i[4]) {
          a += u;
          continue;
        }
        if (a -= u, a > 0)
          continue;
        u = Math.min(u, u + a);
        let c = [...i[0]][0].length, h = e.slice(0, o + i.index + c + u), k = h.slice(o, -o);
        return { type: "del", raw: h, text: k, tokens: this.lexer.inlineTokens(k) };
      }
    }
  }
  autolink(e) {
    let t = this.rules.inline.autolink.exec(e);
    if (t) {
      let n, i;
      return t[2] === "@" ? (n = t[1], i = "mailto:" + n) : (n = t[1], i = n), { type: "link", raw: t[0], text: n, href: i, autolink: true, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  url(e) {
    let t;
    if (t = this.rules.inline.url.exec(e)) {
      let n, i;
      if (t[2] === "@")
        n = t[0], i = "mailto:" + n;
      else {
        let r;
        do
          r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
        while (r !== t[0]);
        n = t[0], t[1] === "www." ? i = "http://" + t[0] : i = t[0];
      }
      return { type: "link", raw: t[0], text: n, href: i, autolink: true, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  inlineText(e) {
    let t = this.rules.inline.text.exec(e);
    if (t) {
      let n = this.lexer.state.inRawBlock;
      return { type: "text", raw: t[0], text: t[0], escaped: n };
    }
  }
};
var x = class l {
  tokens;
  options;
  state;
  inlineQueue;
  tokenizer;
  constructor(e) {
    this.tokens = [], this.tokens.links = Object.create(null), this.options = e || T, this.options.tokenizer = this.options.tokenizer || new y, this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, linkEmitted: false, top: true };
    let t = { other: m, block: G.normal, inline: B.normal };
    this.options.pedantic ? (t.block = G.pedantic, t.inline = B.pedantic) : this.options.gfm && (t.block = G.gfm, this.options.breaks ? t.inline = B.breaks : t.inline = B.gfm), this.tokenizer.rules = t;
  }
  static get rules() {
    return { block: G, inline: B };
  }
  static lex(e, t) {
    return new l(t).lex(e);
  }
  static lexInline(e, t) {
    return new l(t).inlineTokens(e);
  }
  lex(e) {
    e = e.replace(m.carriageReturn, `
`), this.blockTokens(e, this.tokens);
    for (let t = 0;t < this.inlineQueue.length; t++) {
      let n = this.inlineQueue[t];
      this.inlineTokens(n.src, n.tokens);
    }
    return this.inlineQueue = [], this.tokens;
  }
  blockTokens(e, t = [], n = false) {
    this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(m.tabCharGlobal, "    ").replace(m.spaceLine, ""));
    let i = 1 / 0;
    for (;e; ) {
      if (e.length < i)
        i = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      let r;
      if (this.options.extensions?.block?.some((s) => (r = s.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), true) : false))
        continue;
      if (r = this.tokenizer.space(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        r.raw.length === 1 && s !== undefined ? s.raw += `
` : t.push(r);
        continue;
      }
      if (r = this.tokenizer.code(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        s?.type === "paragraph" || s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.at(-1).src = s.text) : t.push(r);
        continue;
      }
      if (r = this.tokenizer.fences(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.heading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.hr(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.blockquote(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.list(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.html(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.def(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        s?.type === "paragraph" || s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.raw, this.inlineQueue.at(-1).src = s.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = { href: r.href, title: r.title }, t.push(r));
        continue;
      }
      if (r = this.tokenizer.table(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.lheading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      let o = e;
      if (this.options.extensions?.startBlock) {
        let s = 1 / 0, u = e.slice(1), a;
        this.options.extensions.startBlock.forEach((p) => {
          a = p.call({ lexer: this }, u), typeof a == "number" && a >= 0 && (s = Math.min(s, a));
        }), s < 1 / 0 && s >= 0 && (o = e.substring(0, s + 1));
      }
      if (this.state.top && (r = this.tokenizer.paragraph(o))) {
        let s = t.at(-1);
        n && s?.type === "paragraph" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s.text) : t.push(r), n = o.length !== e.length, e = e.substring(r.raw.length);
        continue;
      }
      if (r = this.tokenizer.text(e)) {
        e = e.substring(r.raw.length);
        let s = t.at(-1);
        s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s.text) : t.push(r);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return this.state.top = true, t;
  }
  inline(e, t = []) {
    return this.inlineQueue.push({ src: e, tokens: t }), t;
  }
  linkInText(e) {
    if (!e.includes("["))
      return false;
    let t = this.tokenizer.rules.inline.link;
    for (let n of e.matchAll(this.tokenizer.rules.inline.blockSkip))
      if (t.test(n[0]) && e.charAt(n.index - 1) !== "!")
        return true;
    for (let n of e.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
      let i = n[0], r = i.lastIndexOf("[");
      if (!(i.charAt(0) === "!" || !Object.hasOwn(this.tokens.links, D(i.slice(r + 1, -1)))) && !(r > 1 && this.linkInText(i.slice(1, r - 1))))
        return true;
    }
    return false;
  }
  inlineTokens(e, t = []) {
    this.tokenizer.lexer = this;
    let n = e;
    if (this.tokens.links && e.includes("[")) {
      let s = this.tokenizer.rules.inline.reflinkSearch, u = (a) => {
        let p = a.lastIndexOf("[");
        if (!Object.hasOwn(this.tokens.links, D(a.slice(p + 1, -1))))
          return a;
        if (p > 1 && a.charAt(0) !== "!") {
          let c = a.slice(1, p - 1);
          if (this.linkInText(c))
            return "[" + c.replace(s, u) + "][" + "a".repeat(a.length - p - 2) + "]";
        }
        return "[" + "a".repeat(a.length - 2) + "]";
      };
      n = n.replace(s, u);
    }
    n = n.replace(this.tokenizer.rules.inline.anyPunctuation, (s) => "+".repeat(s.length)), n = n.replace(this.tokenizer.rules.inline.blockSkip, (s, u, a) => {
      let p = a ? a.length : 0;
      return s.slice(0, p) + "[" + "a".repeat(s.length - p - 2) + "]";
    }), n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
    let i = false, r = "", o = 1 / 0;
    for (;e; ) {
      if (e.length < o)
        o = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      i || (r = ""), i = false;
      let s;
      if (this.options.extensions?.inline?.some((a) => (s = a.call({ lexer: this }, e, t)) ? (e = e.substring(s.raw.length), t.push(s), true) : false))
        continue;
      if (s = this.tokenizer.escape(e)) {
        e = e.substring(s.raw.length), t.push(s);
        continue;
      }
      if (s = this.tokenizer.tag(e)) {
        e = e.substring(s.raw.length), t.push(s);
        continue;
      }
      if (s = this.tokenizer.link(e)) {
        e = e.substring(s.raw.length), t.push(s);
        continue;
      }
      if (s = this.tokenizer.reflink(e, this.tokens.links)) {
        e = e.substring(s.raw.length);
        let a = t.at(-1);
        s.type === "text" && a?.type === "text" ? (a.raw += s.raw, a.text += s.text) : t.push(s);
        continue;
      }
      if (s = this.tokenizer.emStrong(e, n, r)) {
        e = e.substring(s.raw.length), t.push(s);
        continue;
      }
      if (s = this.tokenizer.codespan(e)) {
        e = e.substring(s.raw.length), t.push(s);
        continue;
      }
      if (s = this.tokenizer.br(e)) {
        e = e.substring(s.raw.length), t.push(s);
        continue;
      }
      if (s = this.tokenizer.del(e, n, r)) {
        e = e.substring(s.raw.length), t.push(s);
        continue;
      }
      if (s = this.tokenizer.autolink(e)) {
        e = e.substring(s.raw.length), t.push(s);
        continue;
      }
      if (!this.state.inLink && (s = this.tokenizer.url(e))) {
        e = e.substring(s.raw.length), t.push(s);
        continue;
      }
      let u = e;
      if (this.options.extensions?.startInline) {
        let a = 1 / 0, p = e.slice(1), c;
        this.options.extensions.startInline.forEach((h) => {
          c = h.call({ lexer: this }, p), typeof c == "number" && c >= 0 && (a = Math.min(a, c));
        }), a < 1 / 0 && a >= 0 && (u = e.substring(0, a + 1));
      }
      if (s = this.tokenizer.inlineText(u)) {
        e = e.substring(s.raw.length), s.raw.slice(-1) !== "_" && (r = s.raw.slice(-1)), i = true;
        let a = t.at(-1);
        a?.type === "text" ? (a.raw += s.raw, a.text += s.text) : t.push(s);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return t;
  }
  infiniteLoopError(e) {
    let t = "Infinite loop on byte: " + e;
    if (this.options.silent)
      console.error(t);
    else
      throw new Error(t);
  }
};
var P = class {
  options;
  parser;
  constructor(e) {
    this.options = e || T;
  }
  space(e) {
    return "";
  }
  code({ text: e, lang: t, escaped: n }) {
    let i = (t || "").match(m.notSpaceStart)?.[0], r = e ? e.replace(m.endingNewline, "") + `
` : "";
    return i ? '<pre><code class="language-' + R(i) + '">' + (n ? r : R(r, true)) + `</code></pre>
` : "<pre><code>" + (n ? r : R(r, true)) + `</code></pre>
`;
  }
  blockquote({ tokens: e }) {
    return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
  }
  html({ text: e }) {
    return e;
  }
  def(e) {
    return "";
  }
  heading({ tokens: e, depth: t }) {
    return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
  }
  hr(e) {
    return `<hr>
`;
  }
  list(e) {
    let { ordered: t, start: n } = e, i = "";
    for (let s = 0;s < e.items.length; s++) {
      let u = e.items[s];
      i += this.listitem(u);
    }
    let r = t ? "ol" : "ul", o = t && n !== 1 ? ' start="' + n + '"' : "";
    return "<" + r + o + `>
` + i + "</" + r + `>
`;
  }
  listitem(e) {
    return `<li>${this.parser.parse(e.tokens)}</li>
`;
  }
  checkbox({ checked: e }) {
    return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
  }
  paragraph({ tokens: e }) {
    return `<p>${this.parser.parseInline(e)}</p>
`;
  }
  table(e) {
    let t = "", n = "";
    for (let r = 0;r < e.header.length; r++)
      n += this.tablecell(e.header[r]);
    t += this.tablerow({ text: n });
    let i = "";
    for (let r = 0;r < e.rows.length; r++) {
      let o = e.rows[r];
      n = "";
      for (let s = 0;s < o.length; s++)
        n += this.tablecell(o[s]);
      i += this.tablerow({ text: n });
    }
    return i && (i = `<tbody>${i}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + i + `</table>
`;
  }
  tablerow({ text: e }) {
    return `<tr>
${e}</tr>
`;
  }
  tablecell(e) {
    let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
    return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
  }
  strong({ tokens: e }) {
    return `<strong>${this.parser.parseInline(e)}</strong>`;
  }
  em({ tokens: e }) {
    return `<em>${this.parser.parseInline(e)}</em>`;
  }
  codespan({ text: e }) {
    return `<code>${R(e, true)}</code>`;
  }
  br(e) {
    return "<br>";
  }
  del({ tokens: e }) {
    return `<del>${this.parser.parseInline(e)}</del>`;
  }
  link({ href: e, title: t, text: n, tokens: i, autolink: r }) {
    let o = r ? R(n, true) : this.parser.parseInline(i), s = ee(e);
    if (s === null)
      return o;
    e = R(s, r);
    let u = '<a href="' + e + '"';
    return t && (u += ' title="' + R(t) + '"'), u += ">" + o + "</a>", u;
  }
  image({ href: e, title: t, text: n, tokens: i }) {
    i && (n = this.parser.parseInline(i, this.parser.textRenderer));
    let r = ee(e);
    if (r === null)
      return R(n);
    e = r;
    let o = `<img src="${R(e)}" alt="${R(n)}"`;
    return t && (o += ` title="${R(t)}"`), o += ">", o;
  }
  text(e) {
    return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : ("escaped" in e) && e.escaped ? e.text : R(e.text);
  }
};
var L = class {
  strong({ text: e }) {
    return e;
  }
  em({ text: e }) {
    return e;
  }
  codespan({ text: e }) {
    return e;
  }
  del({ text: e }) {
    return e;
  }
  html({ text: e }) {
    return e;
  }
  text({ text: e }) {
    return e;
  }
  link({ text: e }) {
    return "" + e;
  }
  image({ text: e }) {
    return "" + e;
  }
  br() {
    return "";
  }
  checkbox({ raw: e }) {
    return e;
  }
};
var b = class l2 {
  options;
  renderer;
  textRenderer;
  constructor(e) {
    this.options = e || T, this.options.renderer = this.options.renderer || new P, this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new L;
  }
  static parse(e, t) {
    return new l2(t).parse(e);
  }
  static parseInline(e, t) {
    return new l2(t).parseInline(e);
  }
  parse(e) {
    this.renderer.parser = this;
    let t = "";
    for (let n = 0;n < e.length; n++) {
      let i = e[n];
      if (this.options.extensions?.renderers?.[i.type]) {
        let o = i, s = this.options.extensions.renderers[o.type].call({ parser: this }, o);
        if (s !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "checkbox", "html", "def", "paragraph", "text"].includes(o.type)) {
          t += s || "";
          continue;
        }
      }
      let r = i;
      switch (r.type) {
        case "space": {
          t += this.renderer.space(r);
          break;
        }
        case "hr": {
          t += this.renderer.hr(r);
          break;
        }
        case "heading": {
          t += this.renderer.heading(r);
          break;
        }
        case "code": {
          t += this.renderer.code(r);
          break;
        }
        case "table": {
          t += this.renderer.table(r);
          break;
        }
        case "blockquote": {
          t += this.renderer.blockquote(r);
          break;
        }
        case "list": {
          t += this.renderer.list(r);
          break;
        }
        case "checkbox": {
          t += this.renderer.checkbox(r);
          break;
        }
        case "html": {
          t += this.renderer.html(r);
          break;
        }
        case "def": {
          t += this.renderer.def(r);
          break;
        }
        case "paragraph": {
          t += this.renderer.paragraph(r);
          break;
        }
        case "text": {
          t += this.renderer.text(r);
          break;
        }
        default: {
          let o = 'Token with "' + r.type + '" type was not found.';
          if (this.options.silent)
            return console.error(o), "";
          throw new Error(o);
        }
      }
    }
    return t;
  }
  parseInline(e, t = this.renderer) {
    this.renderer.parser = this;
    let n = "";
    for (let i = 0;i < e.length; i++) {
      let r = e[i];
      if (this.options.extensions?.renderers?.[r.type]) {
        let s = this.options.extensions.renderers[r.type].call({ parser: this }, r);
        if (s !== false || !["escape", "html", "link", "image", "checkbox", "strong", "em", "codespan", "br", "del", "text"].includes(r.type)) {
          n += s || "";
          continue;
        }
      }
      let o = r;
      switch (o.type) {
        case "escape": {
          n += t.text(o);
          break;
        }
        case "html": {
          n += t.html(o);
          break;
        }
        case "link": {
          n += t.link(o);
          break;
        }
        case "image": {
          n += t.image(o);
          break;
        }
        case "checkbox": {
          n += t.checkbox(o);
          break;
        }
        case "strong": {
          n += t.strong(o);
          break;
        }
        case "em": {
          n += t.em(o);
          break;
        }
        case "codespan": {
          n += t.codespan(o);
          break;
        }
        case "br": {
          n += t.br(o);
          break;
        }
        case "del": {
          n += t.del(o);
          break;
        }
        case "text": {
          n += t.text(o);
          break;
        }
        default: {
          let s = 'Token with "' + o.type + '" type was not found.';
          if (this.options.silent)
            return console.error(s), "";
          throw new Error(s);
        }
      }
    }
    return n;
  }
};
var S = class {
  options;
  block;
  constructor(e) {
    this.options = e || T;
  }
  static passThroughHooks = new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
  static passThroughHooksRespectAsync = new Set(["preprocess", "postprocess", "processAllTokens"]);
  preprocess(e) {
    return e;
  }
  postprocess(e) {
    return e;
  }
  processAllTokens(e) {
    return e;
  }
  emStrongMask(e) {
    return e;
  }
  provideLexer(e = this.block) {
    return e ? x.lex : x.lexInline;
  }
  provideParser(e = this.block) {
    return e ? b.parse : b.parseInline;
  }
};
var Q = class {
  defaults = A();
  options = this.setOptions;
  parse = this.parseMarkdown(true);
  parseInline = this.parseMarkdown(false);
  Parser = b;
  Renderer = P;
  TextRenderer = L;
  Lexer = x;
  Tokenizer = y;
  Hooks = S;
  constructor(...e) {
    this.use(...e);
  }
  walkTokens(e, t) {
    let n = [];
    for (let i of e)
      switch (n = n.concat(t.call(this, i)), i.type) {
        case "table": {
          let r = i;
          for (let o of r.header)
            n = n.concat(this.walkTokens(o.tokens, t));
          for (let o of r.rows)
            for (let s of o)
              n = n.concat(this.walkTokens(s.tokens, t));
          break;
        }
        case "list": {
          let r = i;
          n = n.concat(this.walkTokens(r.items, t));
          break;
        }
        default: {
          let r = i;
          this.defaults.extensions?.childTokens?.[r.type] ? this.defaults.extensions.childTokens[r.type].forEach((o) => {
            let s = r[o].flat(1 / 0);
            n = n.concat(this.walkTokens(s, t));
          }) : r.tokens && (n = n.concat(this.walkTokens(r.tokens, t)));
        }
      }
    return n;
  }
  use(...e) {
    let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
    return e.forEach((n) => {
      let i = { ...n };
      if (i.async = this.defaults.async || i.async || false, n.extensions && (n.extensions.forEach((r) => {
        if (!r.name)
          throw new Error("extension name required");
        if ("renderer" in r) {
          let o = t.renderers[r.name];
          o ? t.renderers[r.name] = function(...s) {
            let u = r.renderer.apply(this, s);
            return u === false && (u = o.apply(this, s)), u;
          } : t.renderers[r.name] = r.renderer;
        }
        if ("tokenizer" in r) {
          if (!r.level || r.level !== "block" && r.level !== "inline")
            throw new Error("extension level must be 'block' or 'inline'");
          let o = t[r.level];
          o ? o.unshift(r.tokenizer) : t[r.level] = [r.tokenizer], r.start && (r.level === "block" ? t.startBlock ? t.startBlock.push(r.start) : t.startBlock = [r.start] : r.level === "inline" && (t.startInline ? t.startInline.push(r.start) : t.startInline = [r.start]));
        }
        "childTokens" in r && r.childTokens && (t.childTokens[r.name] = r.childTokens);
      }), i.extensions = t), n.renderer) {
        let r = this.defaults.renderer || new P(this.defaults);
        for (let o in n.renderer) {
          if (!(o in r))
            throw new Error(`renderer '${o}' does not exist`);
          if (["options", "parser"].includes(o))
            continue;
          let s = o, u = n.renderer[s], a = r[s];
          r[s] = (...p) => {
            let c = u.apply(r, p);
            return c === false && (c = a.apply(r, p)), c || "";
          };
        }
        i.renderer = r;
      }
      if (n.tokenizer) {
        let r = this.defaults.tokenizer || new y(this.defaults);
        for (let o in n.tokenizer) {
          if (!(o in r))
            throw new Error(`tokenizer '${o}' does not exist`);
          if (["options", "rules", "lexer"].includes(o))
            continue;
          let s = o, u = n.tokenizer[s], a = r[s];
          r[s] = (...p) => {
            let c = u.apply(r, p);
            return c === false && (c = a.apply(r, p)), c;
          };
        }
        i.tokenizer = r;
      }
      if (n.hooks) {
        let r = this.defaults.hooks || new S;
        for (let o in n.hooks) {
          if (!(o in r))
            throw new Error(`hook '${o}' does not exist`);
          if (["options", "block"].includes(o))
            continue;
          let s = o, u = n.hooks[s], a = r[s];
          S.passThroughHooks.has(o) ? r[s] = (p) => {
            if (this.defaults.async && S.passThroughHooksRespectAsync.has(o))
              return (async () => {
                let h = await u.call(r, p);
                return a.call(r, h);
              })();
            let c = u.call(r, p);
            return a.call(r, c);
          } : r[s] = (...p) => {
            if (this.defaults.async)
              return (async () => {
                let h = await u.apply(r, p);
                return h === false && (h = await a.apply(r, p)), h;
              })();
            let c = u.apply(r, p);
            return c === false && (c = a.apply(r, p)), c;
          };
        }
        i.hooks = r;
      }
      if (n.walkTokens) {
        let r = this.defaults.walkTokens, o = n.walkTokens;
        i.walkTokens = function(s) {
          let u = [];
          return u.push(o.call(this, s)), r && (u = u.concat(r.call(this, s))), u;
        };
      }
      this.defaults = { ...this.defaults, ...i };
    }), this;
  }
  setOptions(e) {
    return this.defaults = { ...this.defaults, ...e }, this;
  }
  lexer(e, t) {
    return x.lex(e, t ?? this.defaults);
  }
  parser(e, t) {
    return b.parse(e, t ?? this.defaults);
  }
  parseMarkdown(e) {
    return (n, i) => {
      let r = { ...i }, o = { ...this.defaults, ...r }, s = this.onError(!!o.silent, !!o.async);
      if (this.defaults.async === true && r.async === false)
        return s(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      if (typeof n > "u" || n === null)
        return s(new Error("marked(): input parameter is undefined or null"));
      if (typeof n != "string")
        return s(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
      if (o.hooks && (o.hooks.options = o, o.hooks.block = e), o.async)
        return (async () => {
          let u = o.hooks ? await o.hooks.preprocess(n) : n, p = await (o.hooks ? await o.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(u, o), c = o.hooks ? await o.hooks.processAllTokens(p) : p;
          o.walkTokens && await Promise.all(this.walkTokens(c, o.walkTokens));
          let k = await (o.hooks ? await o.hooks.provideParser(e) : e ? b.parse : b.parseInline)(c, o);
          return o.hooks ? await o.hooks.postprocess(k) : k;
        })().catch(s);
      try {
        o.hooks && (n = o.hooks.preprocess(n));
        let a = (o.hooks ? o.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(n, o);
        o.hooks && (a = o.hooks.processAllTokens(a)), o.walkTokens && this.walkTokens(a, o.walkTokens);
        let c = (o.hooks ? o.hooks.provideParser(e) : e ? b.parse : b.parseInline)(a, o);
        return o.hooks && (c = o.hooks.postprocess(c)), c;
      } catch (u) {
        return s(u);
      }
    };
  }
  onError(e, t) {
    return (n) => {
      if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
        let i = "<p>An error occurred:</p><pre>" + R(n.message + "", true) + "</pre>";
        return t ? Promise.resolve(i) : i;
      }
      if (t)
        return Promise.reject(n);
      throw n;
    };
  }
};
var M = new Q;
function f(l3, e) {
  return M.parse(l3, e);
}
f.options = f.setOptions = function(l3) {
  return M.setOptions(l3), f.defaults = M.defaults, U(f.defaults), f;
};
f.getDefaults = A;
f.defaults = T;
function bt(...l3) {
  return M.use(...l3), f.defaults = M.defaults, U(f.defaults), f;
}
f.use = bt;
f.walkTokens = function(l3, e) {
  return M.walkTokens(l3, e);
};
f.parseInline = M.parseInline;
f.Parser = b;
f.parser = b.parse;
f.Renderer = P;
f.TextRenderer = L;
f.Lexer = x;
f.lexer = x.lex;
f.Tokenizer = y;
f.Hooks = S;
f.parse = f;
var un = f.options;
var pn = f.setOptions;
var cn = f.walkTokens;
var hn = f.parseInline;
var kn = b.parse;
var gn = x.lex;

// src/core/dom/style.ts
var DEFAULT_FONT_SIZE_PT = 11;
var HANGING_INDENT_PT = 18;
var TABLE_CHROME_KEYS = [
  "borderColor",
  "borderWidth",
  "cellBackground",
  "cellPadding",
  "columnWidth",
  "contentAlignment",
  "minRowHeight",
  "pinnedHeaderRows",
  "preventOverflow"
];
function colorHex(rgb) {
  if (!rgb || typeof rgb.red !== "number")
    return;
  const ch = (n) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, "0");
  return `#${ch(rgb.red ?? 0)}${ch(rgb.green ?? 0)}${ch(rgb.blue ?? 0)}`.toUpperCase();
}
var hexColor = colorHex;
function colorHsl(hex) {
  let clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return { h: 0, l: 0, s: 0 };
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b2 = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b2);
  const min = Math.min(r, g, b2);
  const delta = max - min;
  const l3 = (max + min) / 2;
  if (delta === 0) {
    return { h: 0, l: l3, s: 0 };
  }
  const s = l3 > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h = 0;
  if (max === r) {
    h = ((g - b2) / delta + (g < b2 ? 6 : 0)) * 60;
  } else if (max === g) {
    h = ((b2 - r) / delta + 2) * 60;
  } else {
    h = ((r - g) / delta + 4) * 60;
  }
  return { h, l: l3, s };
}
function colorMatchesPattern(hex, pattern) {
  const normPat = pattern.trim().toLowerCase();
  const normHex = hex.trim().toLowerCase().replace(/^#/, "");
  const formattedHex = `#${normHex}`;
  if (normPat === "default" || normPat === "#000000" || normPat === "000000") {
    return normHex === "000000" || normHex === "";
  }
  const patClean = normPat.replace(/^#/, "");
  if (/^[0-9a-f]{3,6}$/.test(patClean) && (patClean.length === 3 || patClean.length === 6)) {
    const fullPat = patClean.length === 3 ? patClean.split("").map((c) => c + c).join("") : patClean;
    return normHex === fullPat;
  }
  const { h, l: l3, s } = colorHsl(formattedHex);
  switch (normPat) {
    case "red":
      return (h >= 345 || h <= 15) && s >= 0.25 && l3 >= 0.15 && l3 <= 0.85;
    case "orange":
      return h > 15 && h < 40 && s >= 0.25 && l3 >= 0.15 && l3 <= 0.85;
    case "yellow":
      return h >= 40 && h <= 70 && s >= 0.25 && l3 >= 0.2 && l3 <= 0.85;
    case "green":
      return h > 70 && h <= 165 && s >= 0.2 && l3 >= 0.15 && l3 <= 0.85;
    case "blue":
      return h >= 180 && h <= 260 && s >= 0.2 && l3 >= 0.15 && l3 <= 0.85;
    case "purple":
      return h > 260 && h < 345 && s >= 0.2 && l3 >= 0.15 && l3 <= 0.85;
    case "gray":
    case "grey":
      return s < 0.18 && l3 >= 0.15 && l3 <= 0.85;
    default:
      return false;
  }
}
function colorOptional(hex) {
  return { color: { rgbColor: colorRgb(hex) } };
}
var optionalColor = colorOptional;
function colorRgb(hex) {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`Color must be #RRGGBB, got ${hex}`);
  }
  return {
    blue: parseInt(h.slice(4, 6), 16) / 255,
    green: parseInt(h.slice(2, 4), 16) / 255,
    red: parseInt(h.slice(0, 2), 16) / 255
  };
}
function firstLineHanging(indentStart) {
  return Math.max(0, indentStart - HANGING_INDENT_PT);
}
var hangingFirstLine = firstLineHanging;
function fontColorsMatch(colors, patterns) {
  if (!patterns.length)
    return true;
  const positive = patterns.filter((p) => !p.startsWith("!"));
  const negative = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1).trim());
  const defaultExclusions = negative.filter((n) => n.toLowerCase() === "default" || n === "#000000" || n === "000000");
  const specificExclusions = negative.filter((n) => n.toLowerCase() !== "default" && n !== "#000000" && n !== "000000");
  if (specificExclusions.length > 0) {
    if (colors.some((c) => specificExclusions.some((pat) => colorMatchesPattern(c, pat)))) {
      return false;
    }
  }
  if (defaultExclusions.length > 0) {
    const hasNonDefault = colors.some((c) => !colorMatchesPattern(c, "default"));
    if (!hasNonDefault)
      return false;
  }
  if (positive.length > 0) {
    const effectiveColors = colors.length > 0 ? colors : ["#000000"];
    if (!effectiveColors.some((c) => positive.some((pat) => colorMatchesPattern(c, pat)))) {
      return false;
    }
  }
  return true;
}
function indentHas(patch) {
  return patch.indentStart != null || patch.indentFirstLine != null || patch.indentEnd != null;
}
var hasIndent = indentHas;
function indentOmit(patch) {
  const next = { ...patch };
  delete next.indentStart;
  delete next.indentFirstLine;
  delete next.indentEnd;
  return next;
}
var omitIndent = indentOmit;
function monospaceFontIs(rawFont) {
  if (!rawFont)
    return false;
  const font = rawFont.replace(/['"]/g, "").trim().toLowerCase();
  if (MONOSPACE_FONTS.has(font))
    return true;
  if (font.includes("mono") || font.includes("code") || font.includes("courier") || font.includes("console")) {
    return true;
  }
  return false;
}
var isMonospaceFont = monospaceFontIs;
function point(magnitude) {
  return { magnitude, unit: "PT" };
}
var pt2 = point;
function queryTextStyleUniform(styles) {
  if (!styles.length)
    return;
  const chromes = styles.map(readRunChrome);
  const out = {};
  if (chromes.every((c) => c.italic))
    out.italic = true;
  const sizes = chromes.map((c) => c.fontSize);
  if (sizes.every((s) => s === sizes[0]) && sizes[0] != null && sizes[0] !== DEFAULT_FONT_SIZE_PT) {
    out.fontSize = sizes[0];
  }
  const colors = chromes.map((c) => c.foregroundColor);
  if (colors.every((c) => c === colors[0]) && colors[0] && colors[0].toUpperCase() !== DEFAULT_FOREGROUND) {
    out.foregroundColor = colors[0];
  }
  return Object.keys(out).length ? out : undefined;
}
var uniformQueryTextStyle = queryTextStyleUniform;
function runChromeRead(style2) {
  const s = style2 ?? {};
  const font = s.fontSize;
  let fontSize;
  if (font && typeof font === "object" && font !== null && "magnitude" in font) {
    const mag = font.magnitude;
    if (typeof mag === "number")
      fontSize = mag;
  }
  const fg = s.foregroundColor;
  let foregroundColor;
  if (fg && typeof fg === "object" && fg !== null) {
    const rgb = fg.color?.rgbColor;
    foregroundColor = colorHex(rgb);
  }
  return {
    italic: s.italic === true,
    ...fontSize != null ? { fontSize } : {},
    ...foregroundColor ? { foregroundColor } : {}
  };
}
var readRunChrome = runChromeRead;
function styleHas(patch) {
  if (!patch)
    return false;
  return STYLE_KEYS.some((k) => patch[k] !== undefined);
}
var hasStyle = styleHas;
function tableChromeHas(patch) {
  return TABLE_CHROME_KEYS.some((k) => patch[k] !== undefined);
}
var hasTableChrome = tableChromeHas;
var DEFAULT_FOREGROUND = "#000000";
var MONOSPACE_FONTS = new Set([
  "consolas",
  "courier",
  "courier new",
  "fira code",
  "inconsolata",
  "menlo",
  "monaco",
  "monospace",
  "pt mono",
  "roboto mono",
  "source code pro",
  "space mono",
  "ubuntu mono"
]);
var STYLE_KEYS = [
  "alignment",
  "backgroundColor",
  "bold",
  "borderColor",
  "borderWidth",
  "cellBackground",
  "cellPadding",
  "cellTextAlignment",
  "columnCount",
  "columnWidth",
  "contentAlignment",
  "fontFamily",
  "fontSize",
  "foregroundColor",
  "italic",
  "indentEnd",
  "indentFirstLine",
  "indentStart",
  "lineSpacing",
  "minRowHeight",
  "pinnedHeaderRows",
  "preventOverflow",
  "shading",
  "spaceAbove",
  "spaceBelow",
  "strikethrough",
  "underline"
];

// src/core/inline.ts
function hasActiveStyle(style2) {
  return Boolean(style2.backgroundColor || style2.bold || style2.code || style2.fontFamily || style2.fontSize || style2.foregroundColor || style2.italic || style2.link || style2.strikethrough || style2.underline);
}
function createDirectiveExtension() {
  return {
    name: "directiveStyle",
    level: "inline",
    start(src) {
      return src.indexOf("::");
    },
    tokenizer(src) {
      if (!src.startsWith("::"))
        return;
      const matchName = /^::([a-zA-Z0-9_-]+)\[/.exec(src);
      if (!matchName)
        return;
      const styleName = matchName[1];
      let depth = 1;
      let idx = matchName[0].length;
      while (idx < src.length) {
        if (src[idx] === "\\" && idx + 1 < src.length) {
          idx += 2;
          continue;
        }
        if (src[idx] === "[") {
          depth++;
        } else if (src[idx] === "]") {
          depth--;
          if (depth === 0) {
            if (src.slice(idx + 1, idx + 3) === "::") {
              const raw = src.slice(0, idx + 3);
              const content = src.slice(matchName[0].length, idx);
              const lexer = this?.lexer;
              return {
                type: "directiveStyle",
                raw,
                styleName,
                text: content,
                tokens: lexer ? lexer.inlineTokens(content, []) : []
              };
            }
            return;
          }
        }
        idx++;
      }
      return;
    }
  };
}
var markedInstance = new Q;
markedInstance.use({ extensions: [createDirectiveExtension()] });

class InlineMarkup {
  static #scopedLinkResolver;
  static #scopedStyles;
  static withLinkResolver(linkResolver, fn) {
    const prev = InlineMarkup.#scopedLinkResolver;
    InlineMarkup.#scopedLinkResolver = linkResolver;
    try {
      const res = fn();
      if (res && typeof res.then === "function") {
        return res.finally(() => {
          InlineMarkup.#scopedLinkResolver = prev;
        });
      }
      InlineMarkup.#scopedLinkResolver = prev;
      return res;
    } catch (err) {
      InlineMarkup.#scopedLinkResolver = prev;
      throw err;
    }
  }
  static withStyles(styles, fn) {
    const prev = InlineMarkup.#scopedStyles;
    InlineMarkup.#scopedStyles = styles;
    try {
      const res = fn();
      if (res && typeof res.then === "function") {
        return res.finally(() => {
          InlineMarkup.#scopedStyles = prev;
        });
      }
      InlineMarkup.#scopedStyles = prev;
      return res;
    } catch (err) {
      InlineMarkup.#scopedStyles = prev;
      throw err;
    }
  }
  static resolveRuns(plainText, parsedRuns, customRuns) {
    const runs = [...parsedRuns];
    if (!customRuns?.length)
      return runs;
    for (const cr of customRuns) {
      let start = cr.start;
      let end = cr.end;
      if (cr.text && (start == null || end == null)) {
        const idx = plainText.indexOf(cr.text);
        if (idx !== -1) {
          start = idx;
          end = idx + cr.text.length;
        }
      }
      if (start != null && end != null && end > start) {
        runs.push({
          backgroundColor: cr.backgroundColor,
          bold: cr.bold,
          code: cr.code,
          end,
          fontFamily: cr.fontFamily,
          fontSize: cr.fontSize,
          foregroundColor: cr.foregroundColor,
          italic: cr.italic,
          link: cr.link,
          start,
          strikethrough: cr.strikethrough,
          underline: cr.underline
        });
      }
    }
    return runs;
  }
  static mergeRuns(runs) {
    if (!runs.length)
      return [];
    const sorted = [...runs].sort((a, b2) => a.start - b2.start);
    const out = [{ ...sorted[0] }];
    for (const run of sorted.slice(1)) {
      const prev = out[out.length - 1];
      if (prev.backgroundColor === run.backgroundColor && prev.bold === run.bold && prev.code === run.code && prev.end === run.start && prev.fontFamily === run.fontFamily && prev.fontSize === run.fontSize && prev.foregroundColor === run.foregroundColor && prev.italic === run.italic && prev.link === run.link && prev.strikethrough === run.strikethrough && prev.underline === run.underline) {
        prev.end = run.end;
      } else {
        out.push({ ...run });
      }
    }
    return out;
  }
  static parse(input, customStyles) {
    const styles = customStyles ?? InlineMarkup.#scopedStyles;
    const tokens = markedInstance.Lexer.lexInline(input, markedInstance.defaults);
    let plain = "";
    const runs = [];
    function emit(text, style2) {
      if (!text)
        return;
      const start = plain.length;
      plain += text;
      const end = plain.length;
      if (hasActiveStyle(style2)) {
        runs.push({
          ...style2.backgroundColor ? { backgroundColor: style2.backgroundColor } : {},
          ...style2.bold ? { bold: true } : {},
          ...style2.code ? { code: true } : {},
          end,
          ...style2.fontFamily ? { fontFamily: style2.fontFamily } : {},
          ...style2.fontSize ? { fontSize: style2.fontSize } : {},
          ...style2.foregroundColor ? { foregroundColor: style2.foregroundColor } : {},
          ...style2.italic ? { italic: true } : {},
          ...style2.link ? { link: style2.link } : {},
          start,
          ...style2.strikethrough ? { strikethrough: true } : {},
          ...style2.underline ? { underline: true } : {}
        });
      }
    }
    function walk2(tokenList, currentStyle) {
      for (const token of tokenList) {
        switch (token.type) {
          case "directiveStyle": {
            const directive = token;
            const custom = styles?.[directive.styleName];
            const nextStyle = custom ? { ...currentStyle, ...custom } : currentStyle;
            if (directive.tokens && directive.tokens.length > 0) {
              walk2(directive.tokens, nextStyle);
            } else {
              emit(directive.text, nextStyle);
            }
            break;
          }
          case "strong": {
            if (token.tokens && token.tokens.length > 0) {
              walk2(token.tokens, { ...currentStyle, bold: true });
            } else {
              emit(token.text, { ...currentStyle, bold: true });
            }
            break;
          }
          case "em": {
            if (token.tokens && token.tokens.length > 0) {
              walk2(token.tokens, { ...currentStyle, italic: true });
            } else {
              emit(token.text, { ...currentStyle, italic: true });
            }
            break;
          }
          case "codespan": {
            emit(token.text, { ...currentStyle, code: true });
            break;
          }
          case "del": {
            if (token.tokens && token.tokens.length > 0) {
              walk2(token.tokens, { ...currentStyle, strikethrough: true });
            } else {
              emit(token.text, { ...currentStyle, strikethrough: true });
            }
            break;
          }
          case "link": {
            const rawHref = token.href;
            const resolver = InlineMarkup.#scopedLinkResolver;
            const href = resolver ? resolver(rawHref) : rawHref;
            if (token.tokens && token.tokens.length > 0) {
              walk2(token.tokens, { ...currentStyle, link: href });
            } else {
              emit(token.text, { ...currentStyle, link: href });
            }
            break;
          }
          case "text": {
            if ("tokens" in token && Array.isArray(token.tokens)) {
              walk2(token.tokens, currentStyle);
            } else {
              emit(token.text, currentStyle);
            }
            break;
          }
          case "escape": {
            emit(token.text, currentStyle);
            break;
          }
          case "html": {
            emit(token.raw, currentStyle);
            break;
          }
          case "br": {
            emit(`
`, currentStyle);
            break;
          }
          case "image": {
            emit(token.text, currentStyle);
            break;
          }
          default: {
            if ("tokens" in token && Array.isArray(token.tokens)) {
              walk2(token.tokens, currentStyle);
            } else if ("text" in token && typeof token.text === "string") {
              emit(token.text, currentStyle);
            } else if ("raw" in token && typeof token.raw === "string") {
              emit(token.raw, currentStyle);
            }
            break;
          }
        }
      }
    }
    walk2(tokens, {});
    return { runs: InlineMarkup.mergeRuns(runs), text: plain };
  }
  static serialize(elements) {
    let out = "";
    for (const el of elements) {
      const chip = el.richLink?.richLinkProperties;
      if (chip && (chip.title || chip.uri)) {
        const title = chip.title ?? "";
        let text2 = chip.uri ? `[${title}](${chip.uri})` : title;
        const style3 = el.richLink?.textStyle ?? {};
        if (style3.bold === true)
          text2 = `**${text2}**`;
        else if (style3.italic === true)
          text2 = `*${text2}*`;
        out += text2;
        continue;
      }
      const run = el.textRun;
      if (!run?.content)
        continue;
      const content = run.content.replace(/\n$/, "");
      if (!content)
        continue;
      const style2 = run.textStyle ?? {};
      const bold = style2.bold === true;
      const font = style2.weightedFontFamily?.fontFamily;
      const italic = style2.italic === true;
      const strikethrough = style2.strikethrough === true;
      const linkObj = style2.link;
      let link = linkObj?.url;
      if (!link && linkObj?.heading?.id) {
        link = linkObj.heading.tabId ? `?tab=${linkObj.heading.tabId}#heading=${linkObj.heading.id}` : `#heading=${linkObj.heading.id}`;
      } else if (!link && linkObj?.tabId) {
        link = `?tab=${linkObj.tabId}`;
      } else if (!link && linkObj?.bookmark?.id) {
        link = linkObj.bookmark.tabId ? `?tab=${linkObj.bookmark.tabId}#bookmark=${linkObj.bookmark.id}` : `#bookmark=${linkObj.bookmark.id}`;
      }
      const code = isMonospaceFont(font);
      let text = content;
      if (code) {
        text = `\`${text}\``;
      } else if (link) {
        text = `[${content}](${link})`;
        if (bold)
          text = `**${text}**`;
        else if (italic)
          text = `*${text}*`;
        if (strikethrough)
          text = `~~${text}~~`;
      } else {
        if (bold)
          text = `**${text}**`;
        else if (italic)
          text = `*${text}*`;
        if (strikethrough)
          text = `~~${text}~~`;
      }
      out += text;
    }
    return out;
  }
}

// src/core/requests.ts
class RequestBuilder {
  static buildTableFill(header, rows, tableEl, segmentId, tabId, cellSpecials) {
    const inserts = [];
    const tableRows = tableEl.table?.tableRows ?? [];
    for (let r = 0;r < rows.length; r++) {
      const cells = tableRows[r]?.tableCells ?? [];
      for (let c = 0;c < rows[r]?.length; c++) {
        const cellText = rows[r]?.[c] ?? "";
        const specials = cellSpecials?.[r]?.[c];
        if (!cellText && !specials?.length)
          continue;
        const idx = RequestBuilder.#cellInsertIndex(cells[c] ?? {});
        if (!cellText) {
          inserts.push({ boldRow: false, idx, line: "", runs: [], specials });
          continue;
        }
        const { runs, text: plain } = InlineMarkup.parse(cellText);
        const line = plain.endsWith(`
`) ? plain : `${plain}
`;
        inserts.push({ boldRow: header && r === 0, idx, line, runs, specials });
      }
    }
    inserts.sort((a, b2) => b2.idx - a.idx);
    const requests = [];
    for (const { boldRow, idx, line, runs, specials } of inserts) {
      if (line) {
        requests.push({
          insertText: { location: loc(idx, segmentId, tabId), text: line }
        });
        const textEnd = idx + Math.max(0, line.length - (line.endsWith(`
`) ? 1 : 0));
        if (textEnd > idx) {
          requests.push(RequestBuilder.clearInlineStyles(idx, textEnd, segmentId, tabId));
        }
        requests.push(...RequestBuilder.#textStyleRequests(idx, runs, segmentId, tabId));
        if (boldRow) {
          requests.push({
            updateTextStyle: {
              fields: "bold",
              range: rng(idx, idx + line.length - 1, segmentId, tabId),
              textStyle: { bold: true }
            }
          });
        }
      }
      requests.push(...RequestBuilder.insertInlineSpecials({ index: idx, segmentId, specials, tabId }));
    }
    return requests;
  }
  static splitAfter(endIndex, segmentId, tabId) {
    return {
      insertText: {
        location: loc(Math.max(1, endIndex - 1), segmentId, tabId),
        text: `
`
      }
    };
  }
  static splitBefore(startIndex, segmentId, tabId) {
    return {
      insertText: { location: loc(startIndex, segmentId, tabId), text: `
` }
    };
  }
  static replaceInnerText(startIndex, endIndex, text, segmentId, tabId) {
    const textEnd = Math.max(startIndex, endIndex - 1);
    const requests = [];
    if (textEnd > startIndex) {
      requests.push({
        deleteContentRange: {
          range: rng(startIndex, textEnd, segmentId, tabId)
        }
      });
    }
    if (text.length) {
      requests.push({
        insertText: { location: loc(startIndex, segmentId, tabId), text }
      });
    }
    return requests;
  }
  static createParagraphBullets(startIndex, endIndex, bulletPreset, segmentId, tabId) {
    return {
      createParagraphBullets: {
        bulletPreset,
        range: rng(startIndex, endIndex, segmentId, tabId)
      }
    };
  }
  static deleteParagraphBullets(startIndex, endIndex, segmentId, tabId) {
    return {
      deleteParagraphBullets: {
        range: rng(startIndex, endIndex, segmentId, tabId)
      }
    };
  }
  static indentListLevel(startIndex, endIndex, indent, segmentId, tabId) {
    return {
      updateParagraphStyle: {
        fields: "indentStart,indentFirstLine",
        paragraphStyle: {
          indentFirstLine: pt2(indent.indentFirstLine),
          indentStart: pt2(indent.indentStart)
        },
        range: rng(startIndex, endIndex, segmentId, tabId)
      }
    };
  }
  static indentStart(startIndex, endIndex, magnitude, segmentId, tabId) {
    return {
      updateParagraphStyle: {
        fields: "indentStart",
        paragraphStyle: {
          indentStart: pt2(magnitude)
        },
        range: rng(startIndex, endIndex, segmentId, tabId)
      }
    };
  }
  static namedStyle(startIndex, endIndex, namedStyleType, segmentId, tabId) {
    return {
      updateParagraphStyle: {
        fields: "namedStyleType",
        paragraphStyle: { namedStyleType },
        range: rng(startIndex, endIndex, segmentId, tabId)
      }
    };
  }
  static alignment(startIndex, endIndex, alignment, segmentId, tabId) {
    return {
      updateParagraphStyle: {
        fields: "alignment",
        paragraphStyle: { alignment },
        range: rng(startIndex, endIndex, segmentId, tabId)
      }
    };
  }
  static insertPageBreak(index, segmentId, tabId) {
    return { insertPageBreak: { location: loc(index, segmentId, tabId) } };
  }
  static applyStyle(opts) {
    const { end, patch, segmentId, start, tabId } = opts;
    const requests = [];
    const para = {};
    const paraFields = [];
    if (patch.alignment) {
      paraFields.push("alignment");
      para.alignment = patch.alignment;
    }
    if (patch.spaceAbove != null) {
      paraFields.push("spaceAbove");
      para.spaceAbove = pt2(patch.spaceAbove);
    }
    if (patch.spaceBelow != null) {
      paraFields.push("spaceBelow");
      para.spaceBelow = pt2(patch.spaceBelow);
    }
    if (patch.lineSpacing != null) {
      paraFields.push("lineSpacing");
      para.lineSpacing = patch.lineSpacing;
    }
    if (patch.shading) {
      paraFields.push("shading");
      para.shading = { backgroundColor: optionalColor(patch.shading) };
    }
    RequestBuilder.#indentFields(para, paraFields, patch, Boolean(opts.isBullet));
    if (paraFields.length && !opts.tableWide) {
      requests.push({
        updateParagraphStyle: {
          fields: paraFields.join(","),
          paragraphStyle: para,
          range: rng(start, end, segmentId, tabId)
        }
      });
    }
    if (opts.tableWide && patch.alignment) {
      for (const cell of opts.cellRanges ?? []) {
        if (cell.start < 0 || cell.end <= cell.start)
          continue;
        requests.push({
          updateParagraphStyle: {
            fields: "alignment",
            paragraphStyle: { alignment: patch.alignment },
            range: rng(cell.start, cell.end, segmentId, tabId)
          }
        });
      }
    }
    const text = {};
    const textFields = [];
    if (patch.bold != null) {
      textFields.push("bold");
      text.bold = patch.bold;
    }
    if (patch.italic != null) {
      textFields.push("italic");
      text.italic = patch.italic;
    }
    if (patch.underline != null) {
      textFields.push("underline");
      text.underline = patch.underline;
    }
    if (patch.strikethrough != null) {
      textFields.push("strikethrough");
      text.strikethrough = patch.strikethrough;
    }
    if (patch.foregroundColor) {
      textFields.push("foregroundColor");
      text.foregroundColor = optionalColor(patch.foregroundColor);
    }
    if (patch.backgroundColor) {
      textFields.push("backgroundColor");
      text.backgroundColor = optionalColor(patch.backgroundColor);
    }
    if (patch.fontSize != null) {
      textFields.push("fontSize");
      text.fontSize = pt2(patch.fontSize);
    }
    if (patch.fontFamily) {
      textFields.push("weightedFontFamily");
      text.weightedFontFamily = { fontFamily: patch.fontFamily };
    }
    if (textFields.length && end > start && !opts.tableWide) {
      requests.push({
        updateTextStyle: {
          fields: textFields.join(","),
          range: rng(start, Math.max(start, end - 1), segmentId, tabId),
          textStyle: text
        }
      });
    }
    requests.push(...RequestBuilder.#tableChrome(opts));
    if (patch.columnCount != null) {
      requests.push({
        updateSectionStyle: {
          fields: "columnCount",
          range: rng(start, end, segmentId, tabId),
          sectionStyle: { columnCount: patch.columnCount }
        }
      });
    }
    return requests;
  }
  static #indentFields(para, paraFields, patch, isBullet) {
    if (patch.indentEnd != null) {
      paraFields.push("indentEnd");
      para.indentEnd = pt2(patch.indentEnd);
    }
    if (patch.indentStart != null && patch.indentFirstLine != null) {
      paraFields.push("indentStart", "indentFirstLine");
      para.indentStart = pt2(patch.indentStart);
      para.indentFirstLine = pt2(patch.indentFirstLine);
      return;
    }
    if (patch.indentStart != null) {
      paraFields.push("indentStart");
      para.indentStart = pt2(patch.indentStart);
      if (isBullet) {
        paraFields.push("indentFirstLine");
        para.indentFirstLine = pt2(hangingFirstLine(patch.indentStart));
      }
      return;
    }
    if (patch.indentFirstLine != null) {
      paraFields.push("indentFirstLine");
      para.indentFirstLine = pt2(patch.indentFirstLine);
    }
  }
  static #tableChrome(opts) {
    const { patch, segmentId, tabId } = opts;
    const tableStart = opts.tableStart;
    const needsTable = patch.columnWidth != null || patch.minRowHeight != null || patch.pinnedHeaderRows != null || patch.preventOverflow != null || patch.cellBackground || patch.contentAlignment || patch.cellPadding != null || patch.borderColor;
    if (!needsTable)
      return [];
    if (tableStart == null) {
      throw new Error("columnWidth, borders, cellPadding, contentAlignment, minRowHeight, pinnedHeaderRows, and cellBackground require a table or cell id");
    }
    const startLoc = loc(tableStart, segmentId, tabId);
    const requests = [];
    if (patch.pinnedHeaderRows != null) {
      requests.push({
        pinTableHeaderRows: {
          pinnedHeaderRowsCount: patch.pinnedHeaderRows,
          tableStartLocation: startLoc
        }
      });
    }
    if (patch.preventOverflow != null) {
      requests.push({
        updateTableRowStyle: {
          fields: "preventOverflow",
          tableRowStyle: { preventOverflow: patch.preventOverflow },
          tableStartLocation: startLoc,
          ...opts.cell ? { rowIndices: [opts.cell[0]] } : {}
        }
      });
    }
    if (patch.columnWidth != null) {
      if (patch.columnWidth < 5) {
        throw new Error("columnWidth must be at least 5 PT");
      }
      requests.push({
        updateTableColumnProperties: {
          fields: "widthType,width",
          tableColumnProperties: {
            width: pt2(patch.columnWidth),
            widthType: "FIXED_WIDTH"
          },
          tableStartLocation: startLoc,
          ...opts.cell ? { columnIndices: [opts.cell[1]] } : {}
        }
      });
    }
    if (patch.minRowHeight != null) {
      requests.push({
        updateTableRowStyle: {
          fields: "minRowHeight",
          tableRowStyle: { minRowHeight: pt2(patch.minRowHeight) },
          tableStartLocation: startLoc,
          ...opts.cell ? { rowIndices: [opts.cell[0]] } : {}
        }
      });
    }
    const tableCellStyle = {};
    const fields = [];
    if (patch.cellBackground) {
      fields.push("backgroundColor");
      tableCellStyle.backgroundColor = optionalColor(patch.cellBackground);
    }
    if (patch.contentAlignment) {
      fields.push("contentAlignment");
      tableCellStyle.contentAlignment = patch.contentAlignment;
    }
    if (patch.cellPadding != null) {
      const pad = pt2(patch.cellPadding);
      fields.push("paddingTop", "paddingBottom", "paddingLeft", "paddingRight");
      tableCellStyle.paddingTop = pad;
      tableCellStyle.paddingBottom = pad;
      tableCellStyle.paddingLeft = pad;
      tableCellStyle.paddingRight = pad;
    }
    if (patch.borderColor) {
      const border = {
        color: optionalColor(patch.borderColor),
        dashStyle: "SOLID",
        width: pt2(patch.borderWidth ?? 1)
      };
      fields.push("borderTop", "borderBottom", "borderLeft", "borderRight");
      tableCellStyle.borderTop = border;
      tableCellStyle.borderBottom = border;
      tableCellStyle.borderLeft = border;
      tableCellStyle.borderRight = border;
    } else if (patch.borderWidth != null) {
      throw new Error("borderWidth requires borderColor");
    }
    if (fields.length) {
      requests.push({
        updateTableCellStyle: {
          fields: fields.join(","),
          tableCellStyle,
          ...opts.cell ? {
            tableRange: {
              columnSpan: 1,
              rowSpan: 1,
              tableCellLocation: {
                columnIndex: opts.cell[1],
                rowIndex: opts.cell[0],
                tableStartLocation: startLoc
              }
            }
          } : { tableStartLocation: startLoc }
        }
      });
    }
    return requests;
  }
  static buildTextStyles(baseIndex, runs, segmentId, tabId) {
    return RequestBuilder.#textStyleRequests(baseIndex, runs, segmentId, tabId);
  }
  static clearInlineStyles(startIndex, endIndex, segmentId, tabId) {
    if (endIndex <= startIndex) {
      throw new Error("clearInlineStyles range is empty");
    }
    return {
      updateTextStyle: {
        fields: "bold,italic,underline,strikethrough,smallCaps,baselineOffset,link,weightedFontFamily,fontSize,foregroundColor,backgroundColor",
        range: rng(startIndex, endIndex, segmentId, tabId),
        textStyle: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false
        }
      }
    };
  }
  static cellInsertIndex(cell) {
    return RequestBuilder.#cellInsertIndex(cell);
  }
  static textStyleRequests(baseIndex, runs, segmentId, tabId) {
    return RequestBuilder.#textStyleRequests(baseIndex, runs, segmentId, tabId);
  }
  static #cellInsertIndex(cell) {
    const para = cell.content?.find((el) => el.paragraph != null) ?? cell.content?.[0];
    if (!para)
      throw new Error("table cell missing paragraph");
    return para.startIndex;
  }
  static #textStyleRequests(baseIndex, runs, segmentId, tabId) {
    const requests = [];
    for (const run of runs) {
      if (run.end <= run.start)
        continue;
      const fields = [];
      const style2 = {};
      if (run.bold) {
        fields.push("bold");
        style2.bold = true;
      }
      if (run.code) {
        fields.push("fontSize", "weightedFontFamily");
        style2.fontSize = { magnitude: run.fontSize ?? 10, unit: "PT" };
        style2.weightedFontFamily = { fontFamily: "Courier New" };
      }
      if (run.italic) {
        fields.push("italic");
        style2.italic = true;
      }
      if (run.underline) {
        fields.push("underline");
        style2.underline = true;
      }
      if (run.strikethrough) {
        fields.push("strikethrough");
        style2.strikethrough = true;
      }
      if (run.fontSize && !run.code) {
        fields.push("fontSize");
        style2.fontSize = { magnitude: run.fontSize, unit: "PT" };
      }
      if (run.foregroundColor) {
        fields.push("foregroundColor");
        style2.foregroundColor = optionalColor(run.foregroundColor);
      }
      if (run.backgroundColor) {
        fields.push("backgroundColor");
        style2.backgroundColor = optionalColor(run.backgroundColor);
      }
      if (run.fontFamily && !run.code) {
        fields.push("weightedFontFamily");
        style2.weightedFontFamily = { fontFamily: run.fontFamily };
      }
      if (run.link) {
        fields.push("link");
        style2.link = { url: run.link };
      }
      if (!fields.length)
        continue;
      requests.push({
        updateTextStyle: {
          fields: fields.join(","),
          range: rng(baseIndex + run.start, baseIndex + run.end, segmentId, tabId),
          textStyle: style2
        }
      });
    }
    return requests;
  }
  static addDocumentTab(title, opts = {}) {
    return {
      addDocumentTab: {
        tabProperties: {
          title,
          ...opts.index != null ? { index: opts.index } : {}
        }
      }
    };
  }
  static renameTab(tabId, title) {
    return {
      updateDocumentTabProperties: {
        fields: "title",
        tabProperties: {
          tabId,
          title
        }
      }
    };
  }
  static moveTab(tabId, index) {
    return {
      updateDocumentTabProperties: {
        fields: "index",
        tabProperties: {
          index,
          tabId
        }
      }
    };
  }
  static deleteTab(tabId) {
    return {
      deleteTab: {
        tabId
      }
    };
  }
  static replaceAllText(findText, replaceText, opts = {}) {
    const req = {
      replaceAllText: {
        containsText: {
          matchCase: opts.matchCase ?? true,
          text: findText
        },
        replaceText
      }
    };
    if (opts.tabIds && opts.tabIds.length > 0) {
      req.replaceAllText.tabsCriteria = {
        tabIds: opts.tabIds
      };
    }
    return req;
  }
  static insertTableRow(opts) {
    return {
      insertTableRow: {
        insertBelow: opts.insertBelow !== false,
        tableCellLocation: {
          columnIndex: opts.columnIndex ?? 0,
          rowIndex: opts.rowIndex,
          tableStartLocation: loc(opts.tableStart, opts.segmentId, opts.tabId)
        }
      }
    };
  }
  static deleteTableRow(opts) {
    return {
      deleteTableRow: {
        tableCellLocation: {
          columnIndex: opts.columnIndex ?? 0,
          rowIndex: opts.rowIndex,
          tableStartLocation: loc(opts.tableStart, opts.segmentId, opts.tabId)
        }
      }
    };
  }
  static insertTableColumn(opts) {
    return {
      insertTableColumn: {
        insertRight: opts.insertRight !== false,
        tableCellLocation: {
          columnIndex: opts.columnIndex,
          rowIndex: opts.rowIndex ?? 0,
          tableStartLocation: loc(opts.tableStart, opts.segmentId, opts.tabId)
        }
      }
    };
  }
  static deleteTableColumn(opts) {
    return {
      deleteTableColumn: {
        tableCellLocation: {
          columnIndex: opts.columnIndex,
          rowIndex: opts.rowIndex ?? 0,
          tableStartLocation: loc(opts.tableStart, opts.segmentId, opts.tabId)
        }
      }
    };
  }
  static pinTableHeaderRows(opts) {
    return {
      pinTableHeaderRows: {
        pinnedHeaderRowsCount: opts.pinnedHeaderRowsCount,
        tableStartLocation: loc(opts.tableStart, opts.segmentId, opts.tabId)
      }
    };
  }
  static updateTableRowStyle(opts) {
    const tableRowStyle = {};
    if (opts.minRowHeight != null) {
      tableRowStyle.minRowHeight = pt2(opts.minRowHeight);
    }
    if (opts.preventOverflow != null) {
      tableRowStyle.preventOverflow = opts.preventOverflow;
    }
    if (opts.tableHeader != null) {
      tableRowStyle.tableHeader = opts.tableHeader;
    }
    return {
      updateTableRowStyle: {
        fields: opts.fields,
        ...opts.rowIndices ? { rowIndices: opts.rowIndices } : {},
        tableRowStyle,
        tableStartLocation: loc(opts.tableStart, opts.segmentId, opts.tabId)
      }
    };
  }
  static updateDocumentStyle(opts) {
    return {
      updateDocumentStyle: {
        documentStyle: opts.documentStyle,
        fields: opts.fields,
        ...opts.tabId ? { tabId: opts.tabId } : {}
      }
    };
  }
  static insertSectionBreak(opts) {
    const sectionType = opts.sectionType ?? "NEXT_PAGE";
    if (opts.endOfSegment) {
      return {
        insertSectionBreak: {
          endOfSegmentLocation: loc(opts.index, opts.segmentId, opts.tabId),
          sectionType
        }
      };
    }
    return {
      insertSectionBreak: {
        location: loc(opts.index, opts.segmentId, opts.tabId),
        sectionType
      }
    };
  }
  static insertPerson(opts) {
    return {
      insertPerson: {
        location: loc(opts.index, opts.segmentId, opts.tabId),
        personProperties: {
          email: opts.email
        }
      }
    };
  }
  static insertRichLink(opts) {
    return {
      insertRichLink: {
        location: loc(opts.index, opts.segmentId, opts.tabId),
        richLinkProperties: {
          uri: opts.uri,
          ...opts.mimeType ? { mimeType: opts.mimeType } : {}
        }
      }
    };
  }
  static insertDate(opts) {
    return {
      insertDate: {
        dateElementProperties: {
          ...opts.dateFormat ? { dateFormat: opts.dateFormat } : {},
          ...opts.displayText ? { displayText: opts.displayText } : {},
          ...opts.timestamp ? { timestamp: opts.timestamp } : {}
        },
        location: loc(opts.index, opts.segmentId, opts.tabId)
      }
    };
  }
  static createFootnote(opts) {
    return {
      createFootnote: {
        location: loc(opts.index, opts.segmentId, opts.tabId)
      }
    };
  }
  static insertInlineImage(opts) {
    const objectSize = {};
    if (opts.widthPt != null)
      objectSize.width = pt2(opts.widthPt);
    if (opts.heightPt != null)
      objectSize.height = pt2(opts.heightPt);
    return {
      insertInlineImage: {
        location: loc(opts.index, opts.segmentId, opts.tabId),
        ...Object.keys(objectSize).length ? { objectSize } : {},
        uri: opts.uri
      }
    };
  }
  static insertInlineSpecials(opts) {
    const specials = opts.specials;
    if (!specials?.length)
      return [];
    const ordered = [...specials].sort((a, b2) => b2.offset - a.offset);
    const reqs = [];
    for (const special of ordered) {
      const at2 = opts.index + special.offset;
      if (special.kind === "person") {
        reqs.push(RequestBuilder.insertPerson({
          email: special.email,
          index: at2,
          segmentId: opts.segmentId,
          tabId: opts.tabId
        }));
      } else if (special.kind === "date") {
        reqs.push(RequestBuilder.insertDate({
          dateFormat: special.dateFormat,
          displayText: special.displayText,
          index: at2,
          segmentId: opts.segmentId,
          tabId: opts.tabId,
          timestamp: special.timestamp
        }));
      } else if (special.kind === "richLink") {
        reqs.push(RequestBuilder.insertRichLink({
          index: at2,
          mimeType: special.mimeType,
          segmentId: opts.segmentId,
          tabId: opts.tabId,
          title: special.title,
          uri: special.uri
        }));
      } else {
        reqs.push(RequestBuilder.insertInlineImage({
          heightPt: special.heightPt,
          index: at2,
          segmentId: opts.segmentId,
          tabId: opts.tabId,
          uri: special.uri,
          widthPt: special.widthPt
        }));
      }
    }
    return reqs;
  }
}
function loc(index, segmentId, tabId) {
  return {
    index,
    ...segmentId ? { segmentId } : {},
    ...tabId ? { tabId } : {}
  };
}
function rng(startIndex, endIndex, segmentId, tabId) {
  return {
    endIndex,
    startIndex,
    ...segmentId ? { segmentId } : {},
    ...tabId ? { tabId } : {}
  };
}

// src/core/dom/types.ts
var HEADING_STYLES = new Set([
  "HEADING_1",
  "HEADING_2",
  "HEADING_3",
  "HEADING_4",
  "HEADING_5",
  "HEADING_6",
  "SUBTITLE",
  "TITLE"
]);
var NAMED_STYLES = [
  "NORMAL_TEXT",
  "TITLE",
  "SUBTITLE",
  "HEADING_1",
  "HEADING_2",
  "HEADING_3",
  "HEADING_4",
  "HEADING_5",
  "HEADING_6"
];
var STYLE_TO_LEVEL = {
  HEADING_1: 1,
  HEADING_2: 2,
  HEADING_3: 3,
  HEADING_4: 4,
  HEADING_5: 5,
  HEADING_6: 6,
  NORMAL_TEXT: 99,
  SUBTITLE: 1,
  TITLE: 0
};
function alignmentAs(raw) {
  if (!raw)
    return;
  return ALIGN_SET.has(raw) ? raw : undefined;
}
var asAlignment = alignmentAs;
function contentAlignmentAs(raw) {
  if (!raw)
    return;
  return CONTENT_ALIGN_SET.has(raw) ? raw : undefined;
}
var asContentAlignment = contentAlignmentAs;
function headingStyleIs(style2) {
  return style2 != null && HEADING_STYLES.has(style2);
}
var isHeadingStyle = headingStyleIs;
function namedStyleAs(raw) {
  if (!raw)
    return;
  return NAMED_STYLE_SET.has(raw) ? raw : undefined;
}
var asNamedStyle = namedStyleAs;
var ALIGN_SET = new Set(["CENTER", "END", "JUSTIFIED", "START"]);
var CONTENT_ALIGN_SET = new Set(["BOTTOM", "MIDDLE", "TOP"]);
var NAMED_STYLE_SET = new Set(NAMED_STYLES);

// src/core/dom/guards.ts
var CHIP_MUTATE_MSG = "Caution: this paragraph has smart chips. innerText and remove destroy them. Query shows chips[].";
var DOUBLE_NUMBER_MSG = "Numbered prefix on a bullet paragraph would double-number. Put the number in the list preset, not the text.";
var EMPTY_BULLET_MSG = 'Empty or dash-only list item — createParagraphBullets on a blank item demotes the next heading. Use a visible placeholder like "<item>", not "", "-", or "–".';
var EXISTING_NEST_MSG = "Cannot change nestingLevel on an existing paragraph (leading tabs are already stripped). Insert a new item at the desired nestingLevel.";
var FAKE_BULLET_MSG = "Text starts with a markdown/unicode bullet. Use bullet: { preset } on NORMAL_TEXT, not a typed prefix.";
var HEADING_BULLET_MSG = "Cannot set bullet on TITLE, SUBTITLE, or HEADING_*. Lists are NORMAL_TEXT paragraphs.";
function bulletTextIsEmpty(text) {
  const t = text.replace(/\n$/, "").trim();
  return !t || DASH_ONLY.test(t);
}
function chipsHave(node) {
  return Boolean(node?.chips?.length);
}
var hasChips = chipsHave;
function fakeBulletPrefixIs(text) {
  return FAKE_BULLET_PREFIX.test(text.replace(/\n$/, ""));
}
function numberedPrefixIs(text) {
  return NUMBERED_PREFIX.test(text.replace(/\n$/, ""));
}
function writableAssert(node, opts = {}) {
  if (opts.force)
    return;
  const text = node.text ?? "";
  const hasBullet = Boolean(node.bullet);
  if (hasBullet && headingStyleIs(node.namedStyleType)) {
    throw new Error(HEADING_BULLET_MSG);
  }
  if (hasBullet && bulletTextIsEmpty(text)) {
    throw new Error(EMPTY_BULLET_MSG);
  }
  if (hasBullet && numberedPrefixIs(text)) {
    throw new Error(DOUBLE_NUMBER_MSG);
  }
  if (hasBullet && fakeBulletPrefixIs(text)) {
    throw new Error(FAKE_BULLET_MSG);
  }
  if (!hasBullet && node.namedStyleType === "NORMAL_TEXT" && fakeBulletPrefixIs(text)) {
    throw new Error(FAKE_BULLET_MSG);
  }
}
var assertWritable = writableAssert;
var DASH_ONLY = /^[-–—]$/;
var FAKE_BULLET_PREFIX = /^\s*[-–—*•◦●○■‣·]\s+/;
var NUMBERED_PREFIX = /^\s*\d+[.)]\s+/;

// src/core/dom/ops.ts
import { existsSync as existsSync11, readFileSync as readFileSync6, statSync as statSync2 } from "node:fs";

// src/core/dom/checksum.ts
import { createHash } from "node:crypto";
function cellChecksumCompute(cell) {
  const normText = (cell.text ?? "").trim().replace(/\r\n/g, `
`);
  const styleStr = cell.style ? JSON.stringify(sortObjectKeys(cell.style)) : "";
  const alignStr = cell.alignment ?? "";
  const shadingStr = cell.shading ?? ("backgroundColor" in cell ? cell.backgroundColor ?? "" : "");
  const imagesCount = cell.images?.length ?? 0;
  const chipsCount = cell.chips?.length ?? 0;
  const payload = [
    "cell",
    normText,
    alignStr,
    shadingStr,
    styleStr,
    imagesCount ? `img:${imagesCount}` : "",
    chipsCount ? `chips:${chipsCount}` : ""
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 4);
}
var computeCellChecksum = cellChecksumCompute;
function nodeChecksumCompute(node) {
  const normText = (typeof node.text === "string" ? node.text : "").trim().replace(/\r\n/g, `
`);
  const styleStr = node.style ? JSON.stringify(sortObjectKeys(node.style)) : "";
  const bullet = node.bullet;
  let bulletStr = "";
  if (bullet) {
    const nesting = typeof bullet.nestingLevel === "number" ? bullet.nestingLevel : 0;
    const type = bullet.type ?? (bullet.preset?.startsWith("NUMBERED") ? "NUMBERED" : "BULLET");
    bulletStr = `${type}:${nesting}`;
  }
  const alignStr = typeof node.alignment === "string" ? node.alignment : "";
  const imagesCount = Array.isArray(node.images) ? node.images.length : 0;
  const chipsCount = Array.isArray(node.chips) ? node.chips.length : 0;
  let tableShape = "";
  if (node.table && typeof node.table === "object") {
    const t = node.table;
    if (Array.isArray(t.cells)) {
      tableShape = `${t.cells.length}x${t.cells[0]?.length ?? 0}`;
    } else if (Array.isArray(t.rows)) {
      tableShape = `${t.rows.length}x${t.rows[0]?.length ?? 0}`;
    }
  }
  const payload = [
    node.kind ?? "paragraph",
    node.namedStyleType ?? "",
    normText,
    alignStr,
    bulletStr,
    styleStr,
    tableShape,
    imagesCount ? `img:${imagesCount}` : "",
    chipsCount ? `chips:${chipsCount}` : ""
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 4);
}
var computeNodeChecksum = nodeChecksumCompute;
function sortObjectKeys(obj) {
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    if (val !== undefined && val !== null) {
      if (typeof val === "object" && !Array.isArray(val)) {
        sorted[key] = sortObjectKeys(val);
      } else {
        sorted[key] = val;
      }
    }
  }
  return sorted;
}

// src/core/dom/inlineSpecials.ts
function paragraphInlineClone(node) {
  return inlineClonePlan(node.text ?? "", node.chips, node.images);
}
function tableCellInlineClone(cell) {
  const paras = cell.paragraphs?.length ? cell.paragraphs : [cell];
  const parts = paras.map((p) => {
    const sourceText = p.chips?.length || p.images?.length ? p.text ?? "" : p.markup ?? p.text ?? "";
    return inlineClonePlan(sourceText, p.chips, p.images);
  });
  const specials = [];
  const unclonable = [];
  const texts = [];
  let offset = 0;
  for (let i = 0;i < parts.length; i++) {
    const part = parts[i];
    texts.push(part.text);
    for (const special of part.specials) {
      specials.push({ ...special, offset: special.offset + offset });
    }
    unclonable.push(...part.unclonable);
    offset += part.text.length + (i < parts.length - 1 ? 1 : 0);
  }
  return { specials, text: texts.join(`
`), unclonable };
}
function unclonableFromNode(node) {
  const loc2 = node.scopedId ? `node ${node.scopedId}` : `node ${node.tapeIndex}`;
  const out = [];
  if (node.hasEquation)
    out.push(`${loc2}: contains a math equation`);
  if (node.hasHorizontalRule)
    out.push(`${loc2}: contains a horizontal rule`);
  if (node.footnoteIds?.length)
    out.push(`${loc2}: contains ${node.footnoteIds.length} footnote(s)`);
  if (node.kind === "tableOfContents")
    out.push(`${loc2}: Table of Contents`);
  if (node.kind === "table" && node.table) {
    for (const row of node.table.cells) {
      for (const cell of row) {
        const cellLoc = cell.scopedId ? `cell ${cell.scopedId}` : "table cell";
        const paras = cell.paragraphs?.length ? cell.paragraphs : [cell];
        for (const p of paras) {
          if (p.hasEquation)
            out.push(`${cellLoc}: contains a math equation`);
          if (p.hasHorizontalRule)
            out.push(`${cellLoc}: contains a horizontal rule`);
        }
        const plan2 = tableCellInlineClone(cell);
        out.push(...plan2.unclonable.map((msg) => `${cellLoc}: ${msg}`));
      }
    }
    return out;
  }
  const plan = paragraphInlineClone(node);
  out.push(...plan.unclonable.map((msg) => `${loc2}: ${msg}`));
  return out;
}
function inlineClonePlan(text, chips, images) {
  const unclonable = [];
  const items = [];
  for (const chip of chips ?? []) {
    const converted = chipToSpecial(chip, text);
    if ("unclonable" in converted) {
      unclonable.push(converted.unclonable);
      continue;
    }
    items.push(converted);
  }
  for (const image of images ?? []) {
    const converted = imageToSpecial(image, text);
    if ("unclonable" in converted) {
      unclonable.push(converted.unclonable);
      continue;
    }
    items.push(converted);
  }
  items.sort((a, b2) => a.offset - b2.offset);
  let cursor = 0;
  let outText = "";
  const specials = [];
  for (const item of items) {
    const at2 = Math.max(0, Math.min(item.offset, text.length));
    if (at2 < cursor)
      continue;
    outText += text.slice(cursor, at2);
    if (item.special) {
      specials.push({ ...item.special, offset: outText.length });
    }
    cursor = at2 + item.dropLen;
  }
  outText += text.slice(cursor);
  return { specials, text: outText, unclonable };
}
function chipToSpecial(chip, text) {
  const offset = chip.textOffset ?? 0;
  const kind = chip.kind ?? chipKindInfer(chip);
  if (kind === "person") {
    const email = chip.email ?? emailFromMailto(chip.uri);
    if (!email) {
      return { unclonable: `person chip "${chip.title || chip.uri}" has no email` };
    }
    return { dropLen: 0, offset, special: { email, kind: "person", offset } };
  }
  if (kind === "date") {
    if (!chip.timestamp) {
      return { unclonable: `date chip "${chip.title}" has no timestamp` };
    }
    const special = {
      kind: "date",
      offset,
      timestamp: chip.timestamp
    };
    if (chip.dateFormat)
      special.dateFormat = chip.dateFormat;
    if (chip.title)
      special.displayText = chip.title;
    return { dropLen: 0, offset, special };
  }
  if (kind === "richLink") {
    if (!chip.uri) {
      return { unclonable: `rich link chip "${chip.title}" has no uri` };
    }
    const title = chip.title;
    const dropLen = title && text.startsWith(title, offset) ? title.length : 0;
    const special = { kind: "richLink", offset, uri: chip.uri };
    if (chip.mimeType)
      special.mimeType = chip.mimeType;
    if (title)
      special.title = title;
    return { dropLen, offset, special };
  }
  return { unclonable: `unsupported smart chip "${chip.title || chip.uri}"` };
}
function imageToSpecial(image, text) {
  const offset = image.textOffset ?? 0;
  const uri2 = image.sourceUri ?? "";
  if (!/^https?:\/\//i.test(uri2)) {
    return {
      unclonable: "inline image has no public source URI (Drive/internal images cannot be reinserted via REST)"
    };
  }
  const dropLen = text.startsWith("[Image]", offset) ? "[Image]".length : 0;
  const special = { kind: "inlineImage", offset, uri: uri2 };
  if (image.heightPt != null)
    special.heightPt = image.heightPt;
  if (image.widthPt != null)
    special.widthPt = image.widthPt;
  return { dropLen, offset, special };
}
function chipKindInfer(chip) {
  if (chip.kind)
    return chip.kind;
  if (chip.email || chip.uri?.startsWith("mailto:"))
    return "person";
  if (chip.uri && /^https?:\/\//i.test(chip.uri))
    return "richLink";
  if (chip.timestamp || chip.dateId)
    return "date";
  return;
}
function emailFromMailto(uri2) {
  if (!uri2?.toLowerCase().startsWith("mailto:"))
    return;
  const email = uri2.slice("mailto:".length).trim();
  return email || undefined;
}

// src/core/paragraph.ts
class Paragraph {
  static bulletNestingLevel(paragraph) {
    return paragraph?.bullet?.nestingLevel ?? 0;
  }
  static elements(paragraph) {
    return paragraph?.elements ?? [];
  }
  static isArtifactRun(element) {
    const content = element.textRun?.content ?? "";
    if (!content)
      return false;
    return [...content].some((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 57344 && code <= 63743;
    });
  }
  static isGlyphOnlyText(text) {
    return !Paragraph.stripArtifacts(text);
  }
  static stripArtifacts(text) {
    const stripped = [...text].filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return cp < 57344 || cp > 63743;
    }).join("");
    return stripped.replace(/\s+/g, " ").trim();
  }
  static text(paragraph, trimTrailing = false) {
    const raw = Paragraph.elements(paragraph).map((el) => {
      if (el.textRun?.content)
        return el.textRun.content;
      const title = el.richLink?.richLinkProperties?.title;
      return title ?? "";
    }).join("");
    return trimTrailing ? raw.replace(/\n$/, "") : raw;
  }
}

// src/core/dom/parse.ts
function assignScopedIds(nodes) {
  let currentHeadingId = "_preamble";
  let tableIndexUnderHeading = 0;
  const sectionCounts = new Map;
  for (const node of nodes) {
    if (node.kind === "paragraph" && isHeadingStyle(node.namedStyleType)) {
      currentHeadingId = node.headingId || `h.heading_${node.tapeIndex}`;
      tableIndexUnderHeading = 0;
      const csum2 = computeNodeChecksum(node);
      node.scopedId = `${currentHeadingId}.${csum2}`;
      continue;
    }
    if (node.kind === "table") {
      tableIndexUnderHeading++;
      const tableTag = tableIndexUnderHeading === 1 ? "table" : `table${tableIndexUnderHeading}`;
      const csum2 = computeNodeChecksum(node);
      const base2 = `${currentHeadingId}.${tableTag}.${csum2}`;
      const count2 = (sectionCounts.get(base2) ?? 0) + 1;
      sectionCounts.set(base2, count2);
      node.scopedId = count2 === 1 ? base2 : `${base2}.${count2}`;
      if (node.table) {
        for (let r = 0;r < node.table.cells.length; r++) {
          const row = node.table.cells[r];
          for (let c = 0;c < row.length; c++) {
            const cell = row[c];
            const cellCsum = computeCellChecksum(cell);
            cell.scopedId = `${currentHeadingId}.${tableTag}.${r}.${c}.${cellCsum}`;
            if (cell.paragraphs && cell.paragraphs.length > 1) {
              for (let p = 1;p < cell.paragraphs.length; p++) {
                const para = cell.paragraphs[p];
                para.scopedId = `${currentHeadingId}.${tableTag}.${r}.${c}.${cellCsum}.${p}`;
              }
            }
          }
        }
      }
      continue;
    }
    const csum = computeNodeChecksum(node);
    const base = `${currentHeadingId}.${csum}`;
    const count = (sectionCounts.get(base) ?? 0) + 1;
    sectionCounts.set(base, count);
    node.scopedId = count === 1 ? base : `${base}.${count}`;
  }
}
function documentParse(source) {
  const gdoc = source instanceof Gdoc ? source : new Gdoc(source, source.documentId ?? "");
  const data = tapeData(gdoc);
  return {
    documentId: gdoc.id || data.documentId || "",
    nodes: parseContent(data.body?.content ?? [], data),
    revisionId: data.revisionId,
    segments: parseSegments(data),
    title: data.title ?? ""
  };
}
var parseDocument = documentParse;
function tapeParse(source) {
  const doc = documentParse(source);
  return {
    documentId: doc.documentId,
    nodes: doc.nodes,
    revisionId: doc.revisionId,
    title: doc.title
  };
}
var parseTape = tapeParse;
function parseContent(content, data) {
  const nodes = [];
  let id = 1;
  for (const el of content) {
    const node = parseElement(el, data);
    if (node)
      nodes.push({ ...node, tapeIndex: id++ });
  }
  assignScopedIds(nodes);
  return nodes;
}
function parseSegments(data) {
  const style2 = data.documentStyle ?? {};
  const out = [];
  for (const [id, header] of Object.entries(data.headers ?? {})) {
    out.push({
      kind: "header",
      nodes: parseContent(header.content ?? [], data),
      segmentId: header.headerId || id,
      use: headerUse(id, style2)
    });
  }
  for (const [id, footer] of Object.entries(data.footers ?? {})) {
    out.push({
      kind: "footer",
      nodes: parseContent(footer.content ?? [], data),
      segmentId: footer.footerId || id,
      use: footerUse(id, style2)
    });
  }
  for (const [id, note] of Object.entries(data.footnotes ?? {})) {
    out.push({
      kind: "footnote",
      nodes: parseContent(note.content ?? [], data),
      segmentId: note.footnoteId || id
    });
  }
  return out;
}
function headerUse(id, style2) {
  if (id === style2.defaultHeaderId)
    return "default";
  if (id === style2.firstPageHeaderId)
    return "first";
  if (id === style2.evenPageHeaderId)
    return "even";
  return;
}
function footerUse(id, style2) {
  if (id === style2.defaultFooterId)
    return "default";
  if (id === style2.firstPageFooterId)
    return "first";
  if (id === style2.evenPageFooterId)
    return "even";
  return;
}
function parseElement(el, data) {
  const start = el.startIndex ?? 0;
  const end = el.endIndex;
  if (el.paragraph)
    return parseParagraph(el, start, end, data);
  if (el.table)
    return parseTable(el, start, end, data);
  if (el.tableOfContents) {
    return { end, kind: "tableOfContents", start, tapeIndex: 0 };
  }
  if (el.sectionBreak) {
    const node = { end, kind: "sectionBreak", start, tapeIndex: 0 };
    const cols = el.sectionBreak.sectionStyle?.columnCount;
    if (typeof cols === "number" && cols > 1)
      node.columnCount = cols;
    return node;
  }
  return null;
}
function parseParagraph(el, start, end, data) {
  const paragraph = el.paragraph;
  const hasPageBreak = (paragraph.elements ?? []).some((item) => item.pageBreak);
  const named = asNamedStyle(paragraph.paragraphStyle?.namedStyleType) ?? "NORMAL_TEXT";
  const text = Paragraph.text(paragraph, true);
  if (hasPageBreak && !text.trim()) {
    return { end, kind: "pageBreak", start, tapeIndex: 0 };
  }
  const markup = InlineMarkup.serialize(Paragraph.elements(paragraph)).replace(/\n$/, "");
  const node = {
    end,
    kind: "paragraph",
    namedStyleType: named,
    start,
    tapeIndex: 0,
    text
  };
  if (markup && markup !== text)
    node.markup = markup;
  const bullet = parseBullet(paragraph, data);
  if (bullet)
    node.bullet = bullet;
  const images = parseImages(paragraph, data);
  if (images.length)
    node.images = images;
  const chips = parseChips(paragraph);
  if (chips.length)
    node.chips = chips;
  if (paragraph.paragraphStyle?.headingId) {
    node.headingId = paragraph.paragraphStyle.headingId;
  }
  applyParagraphStyle(node, paragraph.paragraphStyle);
  const style2 = queryStyleFromParagraph(paragraph);
  if (style2)
    node.style = style2;
  const colors = paragraphFontColorsExtract(paragraph);
  if (colors.length > 0)
    node.fontColors = colors;
  const footnotes = footnoteIds(paragraph);
  if (footnotes.length)
    node.footnoteIds = footnotes;
  if ((paragraph.elements ?? []).some((item) => item.equation)) {
    node.hasEquation = true;
  }
  if ((paragraph.elements ?? []).some((item) => item.horizontalRule)) {
    node.hasHorizontalRule = true;
  }
  if (isCodeParagraph(paragraph, named, bullet, node)) {
    node.isCode = true;
  }
  return node;
}
function paragraphFontColorsExtract(paragraph) {
  const colors = new Set;
  for (const el of paragraph.elements ?? []) {
    const content = el.textRun?.content ?? "";
    if (!content.replace(/\n/g, ""))
      continue;
    const chrome = runChromeRead(el.textRun?.textStyle);
    if (chrome.foregroundColor) {
      colors.add(chrome.foregroundColor.toUpperCase());
    }
  }
  return Array.from(colors);
}
function queryStyleFromParagraph(paragraph) {
  const styles = [];
  for (const el of paragraph.elements ?? []) {
    const content = el.textRun?.content ?? "";
    if (!content.replace(/\n/g, ""))
      continue;
    styles.push(el.textRun?.textStyle);
  }
  return uniformQueryTextStyle(styles);
}
function ptMagnitude(dim) {
  if (!dim)
    return;
  if (typeof dim.magnitude === "number")
    return dim.magnitude;
  if (dim.unit === "PT")
    return 0;
  return;
}
function applyParagraphStyle(target, style2) {
  if (!style2)
    return;
  const align = asAlignment(style2.alignment);
  if (align)
    target.alignment = align;
  const indentStart = ptMagnitude(style2.indentStart);
  if (indentStart != null) {
    target.indentStart = { magnitude: indentStart, unit: "PT" };
  }
  const indentFirstLine = ptMagnitude(style2.indentFirstLine);
  if (indentFirstLine != null) {
    target.indentFirstLine = { magnitude: indentFirstLine, unit: "PT" };
  }
  const indentEnd = ptMagnitude(style2.indentEnd);
  if (indentEnd != null) {
    target.indentEnd = { magnitude: indentEnd, unit: "PT" };
  }
  if (typeof style2.lineSpacing === "number")
    target.lineSpacing = style2.lineSpacing;
  if (typeof style2.spaceAbove?.magnitude === "number") {
    target.spaceAbove = style2.spaceAbove.magnitude;
  }
  if (typeof style2.spaceBelow?.magnitude === "number") {
    target.spaceBelow = style2.spaceBelow.magnitude;
  }
  const shade = hexColor(style2.shading?.backgroundColor?.color?.rgbColor);
  if (shade)
    target.shading = shade;
}
function footnoteIds(paragraph) {
  const ids = [];
  for (const el of paragraph.elements ?? []) {
    const id = el.footnoteReference?.footnoteId;
    if (id)
      ids.push(id);
  }
  return ids;
}
function parseCellParagraph(paraEl, data, row, col) {
  const para = paraEl?.paragraph;
  const start = paraEl?.startIndex ?? 0;
  const end = paraEl?.endIndex ?? start;
  const text = para ? Paragraph.text(para, true) : "";
  const markup = para ? InlineMarkup.serialize(Paragraph.elements(para)).replace(/\n$/, "") : "";
  const colors = para ? paragraphFontColorsExtract(para) : [];
  const cell = {
    col,
    end,
    ...colors.length > 0 ? { fontColors: colors } : {},
    row,
    start,
    text
  };
  if (markup && markup !== text)
    cell.markup = markup;
  if (para)
    applyParagraphStyle(cell, para.paragraphStyle);
  if (para) {
    const style2 = queryStyleFromParagraph(para);
    if (style2)
      cell.style = style2;
    const cellImgs = parseImages(para, data).map((img) => ({
      ...img,
      col,
      row
    }));
    if (cellImgs.length)
      cell.images = cellImgs;
    const cellChips = parseChips(para);
    if (cellChips.length)
      cell.chips = cellChips;
    if ((para.elements ?? []).some((item) => item.equation)) {
      cell.hasEquation = true;
    }
    if ((para.elements ?? []).some((item) => item.horizontalRule)) {
      cell.hasHorizontalRule = true;
    }
  }
  return cell;
}
function parseTable(el, start, end, data) {
  const cells = [];
  const images = [];
  const tableRows = el.table?.tableRows ?? [];
  for (let r = 0;r < tableRows.length; r++) {
    const row = [];
    const tableCells = tableRows[r]?.tableCells ?? [];
    for (let c = 0;c < tableCells.length; c++) {
      const tableCell = tableCells[c];
      const paras = (tableCell?.content ?? []).filter((item) => item.paragraph).map((item) => parseCellParagraph(item, data, r, c));
      const first = paras[0] ?? { col: c, end: start, row: r, start, text: "" };
      const paragraphs = paras.length ? paras : [first];
      const cell = {
        ...first,
        col: c,
        paragraphs,
        row: r
      };
      const bg = hexColor(tableCell?.tableCellStyle?.backgroundColor?.color?.rgbColor);
      if (bg)
        cell.backgroundColor = bg;
      for (const p of paragraphs) {
        if (p.images?.length)
          images.push(...p.images);
      }
      row.push(cell);
    }
    cells.push(row);
  }
  const node = { end, kind: "table", start, table: { cells }, tapeIndex: 0 };
  const widths = (el.table?.tableStyle?.tableColumnProperties ?? []).map((p) => p.widthType === "FIXED_WIDTH" && typeof p.width?.magnitude === "number" ? p.width.magnitude : undefined);
  if (widths.length && widths.every((w) => w === widths[0]) && widths[0] != null) {
    node.table.columnWidth = widths[0];
  }
  const firstStyle = tableRows[0]?.tableCells?.[0]?.tableCellStyle;
  const pad = firstStyle?.paddingTop?.magnitude;
  if (typeof pad === "number")
    node.table.cellPadding = pad;
  const align = asContentAlignment(firstStyle?.contentAlignment);
  if (align)
    node.table.contentAlignment = align;
  const borderHex = hexColor(firstStyle?.borderTop?.color?.color?.rgbColor);
  if (borderHex)
    node.table.borderColor = borderHex;
  const minH = tableRows[0]?.tableRowStyle?.minRowHeight?.magnitude;
  if (typeof minH === "number")
    node.table.minRowHeight = minH;
  let pinned = 0;
  for (let r = 0;r < tableRows.length; r++) {
    if (tableRows[r]?.tableRowStyle?.tableHeader)
      pinned++;
    else
      break;
  }
  if (pinned > 0)
    node.table.pinnedHeaderRows = pinned;
  const preventOverflow = tableRows.some((r) => r?.tableRowStyle?.preventOverflow);
  if (preventOverflow)
    node.table.preventOverflow = true;
  if (images.length)
    node.images = images;
  return node;
}
function parseListType(levelProps) {
  if (!levelProps)
    return;
  const glyphType = typeof levelProps.glyphType === "string" ? levelProps.glyphType : undefined;
  if (glyphType && glyphType !== "GLYPH_TYPE_UNSPECIFIED" && glyphType !== "NONE") {
    return "NUMBERED";
  }
  const glyphSymbol = typeof levelProps.glyphSymbol === "string" ? levelProps.glyphSymbol : undefined;
  if (glyphSymbol) {
    if (glyphSymbol === "❑" || glyphSymbol === "☑" || glyphSymbol === "☐") {
      return "CHECKBOX";
    }
    return "BULLET";
  }
  return;
}
function parseBullet(paragraph, data) {
  if (!paragraph.bullet)
    return;
  const lists = data.lists ?? data.tabs?.[0]?.documentTab?.lists ?? {};
  let listId = paragraph.bullet.listId;
  if (!listId) {
    const ids = Object.keys(lists);
    if (ids.length === 1)
      listId = ids[0];
  }
  const nestingLevel = Paragraph.bulletNestingLevel(paragraph);
  const bullet = {
    nestingLevel
  };
  if (listId) {
    bullet.listId = listId;
    const levelProps = lists[listId]?.listProperties?.nestingLevels?.[nestingLevel];
    const type = parseListType(levelProps);
    if (type)
      bullet.type = type;
  }
  return bullet;
}
function parseChips(paragraph) {
  const chips = [];
  const elements = paragraph.elements ?? [];
  for (let i = 0;i < elements.length; i++) {
    const el = elements[i];
    const start = el.startIndex ?? 0;
    const end = el.endIndex ?? start + 1;
    const textOffset = Paragraph.text({ elements: elements.slice(0, i) }, false).length;
    if (el.richLink?.richLinkProperties) {
      const props = el.richLink.richLinkProperties;
      const chip = {
        end,
        kind: "richLink",
        start,
        textOffset,
        title: props.title ?? "",
        uri: props.uri ?? ""
      };
      if (el.richLink?.richLinkId)
        chip.richLinkId = el.richLink.richLinkId;
      if (props.mimeType)
        chip.mimeType = props.mimeType;
      chips.push(chip);
    } else if (el.person?.personProperties) {
      const props = el.person.personProperties;
      const chip = {
        end,
        kind: "person",
        personId: el.person.personId,
        start,
        textOffset,
        title: props.name || props.email || "Person",
        uri: props.email ? `mailto:${props.email}` : ""
      };
      if (props.email)
        chip.email = props.email;
      chips.push(chip);
    } else if (el.dateElement?.dateElementProperties) {
      const props = el.dateElement.dateElementProperties;
      const chip = {
        dateId: el.dateElement.dateId,
        end,
        kind: "date",
        start,
        textOffset,
        title: props.displayText || "Date",
        uri: ""
      };
      if (props.dateFormat)
        chip.dateFormat = props.dateFormat;
      const timestamp = dateTimestampFromProps(props);
      if (timestamp)
        chip.timestamp = timestamp;
      chips.push(chip);
    }
  }
  return chips;
}
function dateTimestampFromProps(props) {
  const raw = props.date;
  if (typeof raw === "string" && raw.trim()) {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? raw : new Date(ms).toISOString();
  }
  if (raw && typeof raw === "object") {
    const year = raw.year;
    const month = raw.month;
    const day = raw.day;
    if (typeof year === "number" && typeof month === "number" && typeof day === "number") {
      return new Date(Date.UTC(year, month - 1, day)).toISOString();
    }
  }
  return;
}
function parseImages(paragraph, data) {
  const images = [];
  const elements = paragraph.elements ?? [];
  for (let i = 0;i < elements.length; i++) {
    const el = elements[i];
    const objectId = el.inlineObjectElement?.inlineObjectId;
    if (!objectId)
      continue;
    const start = el.startIndex ?? 0;
    const end = el.endIndex ?? start + 1;
    const embedded = data.inlineObjects?.[objectId]?.inlineObjectProperties?.embeddedObject;
    const size = embedded?.size;
    const image = {
      end,
      objectId,
      start,
      textOffset: Paragraph.text({ elements: elements.slice(0, i) }, false).length
    };
    const widthPt = size?.width?.magnitude;
    const heightPt = size?.height?.magnitude;
    if (typeof widthPt === "number")
      image.widthPt = widthPt;
    if (typeof heightPt === "number")
      image.heightPt = heightPt;
    const sourceUri = embedded?.imageProperties?.sourceUri;
    if (sourceUri)
      image.sourceUri = sourceUri;
    images.push(image);
  }
  return images;
}
function tapeData(gdoc) {
  const data = gdoc.data;
  if (gdoc.tabId)
    return overlayTab(data, gdoc.tabId);
  const flat = flattenTabs(data.tabs);
  if (flat.length === 1 && !data.body?.content?.length) {
    return overlayTab(data, flat[0]?.tabId);
  }
  return data;
}
function isCodeParagraph(paragraph, namedStyle, bullet, node) {
  if (namedStyle !== "NORMAL_TEXT")
    return false;
  if (bullet)
    return false;
  if (node.images?.length || node.chips?.length || node.footnoteIds?.length)
    return false;
  if (node.hasEquation || node.hasHorizontalRule)
    return false;
  if (!node.text?.trim())
    return false;
  const elements = paragraph?.elements ?? [];
  for (const el of elements) {
    if (!el.textRun)
      return false;
  }
  const textRuns = elements.map((el) => el.textRun).filter((r) => Boolean(r?.content?.replace(/\n/g, "")));
  if (textRuns.length === 0)
    return false;
  return textRuns.every((r) => {
    const font = r.textStyle?.weightedFontFamily?.fontFamily ?? r.textStyle?.fontFamily;
    return isMonospaceFont(font);
  });
}

// src/core/dom/query.ts
var KIND_TYPES = new Set(["paragraph", "table", "tableOfContents", "sectionBreak", "pageBreak"]);
var NAMED_TYPES = new Set(NAMED_STYLES);
var RELATIVE_NTH_MSG = ":nth-sibling(n) and :nth(n) are relative to the previous combinator. Use HEADING_2 + NORMAL_TEXT:nth-sibling(3) or HEADING_2 ~ NORMAL_TEXT[bullet]:nth(1).";
function nodeIdMissingMsg(id, tapeLen, kind = "node") {
  const what = kind === "heading" ? "heading" : "node";
  if (typeof id === "string" && (id.includes(".") || id.startsWith("h."))) {
    return `No ${what} with id "${id}". Copy id from query (heading-scoped, e.g. h.arch.9a1b).`;
  }
  const numeric = typeof id === "number" ? id : Number(id);
  const hint = Number.isFinite(numeric) && numeric > tapeLen ? ` Tape has ${tapeLen} nodes — ${id} looks like a leftover startIndex / raw character offset. Do NOT compute character offsets; copy the heading-scoped id from query (e.g. h.arch.9a1b).` : ` Tape has ${tapeLen} nodes. Copy the heading-scoped id from query (e.g. h.arch.9a1b).`;
  return `No ${what} with id ${id}.${hint}`;
}
var missingNodeIdMsg = nodeIdMissingMsg;
function headingByTitleOrSlugFind(nodes, needle) {
  const headings = nodes.filter((n) => isHeading(n));
  const trimmed = needle.trim();
  const lower = trimmed.toLowerCase();
  const slugTarget = lower.startsWith("h.") ? lower.slice(2) : lower;
  const targetWords = slugTarget.replace(/[-_]+/g, " ").trim();
  const exactHits = headings.filter((h) => {
    const text = (h.text ?? "").trim().toLowerCase();
    return text === lower || text === slugTarget;
  });
  if (exactHits.length === 1)
    return exactHits[0];
  const slugHits = headings.filter((h) => {
    const headingText = (h.text ?? "").trim().toLowerCase();
    const headingWords = headingText.replace(/[^a-z0-9]+/g, " ").trim();
    return headingWords === targetWords;
  });
  if (slugHits.length === 1)
    return slugHits[0];
  return;
}
function nodeAtFind(nodes, at2) {
  const direct = nodes.find((n) => n.tapeIndex === at2 || n.scopedId === at2 || n.headingId === at2 || String(n.tapeIndex) === String(at2));
  if (direct)
    return direct;
  if (typeof at2 === "string") {
    const trimmed = at2.trim();
    const heading = headingByTitleOrSlugFind(nodes, trimmed);
    if (heading)
      return heading;
    if (trimmed.startsWith("h.") && trimmed.includes(".")) {
      const parts = trimmed.split(".");
      if (parts.length === 3) {
        const slugPart = `h.${parts[1]}`;
        const checksum = parts[2];
        const parentHeading = headingByTitleOrSlugFind(nodes, slugPart);
        if (parentHeading) {
          const section = neighborhoodFrom(nodes, parentHeading.tapeIndex);
          const hit = section.find((n) => n.scopedId?.endsWith(`.${checksum}`));
          if (hit)
            return hit;
        }
      }
    }
  }
  return;
}
var findNodeAt = nodeAtFind;
function missingScopedTargetMsgFormat(nodes, rawAt) {
  const atStr = String(rawAt);
  const parts = atStr.split(".");
  const headingPart = atStr.startsWith("h.") && parts.length > 1 ? `${parts[0]}.${parts[1]}` : parts[0];
  const headings = nodes.filter((n) => n.kind === "paragraph" && isHeading(n));
  const targetHeading = headings.find((h) => h.headingId === headingPart || h.scopedId?.startsWith(`${headingPart}.`) || h.scopedId === headingPart);
  if (!targetHeading && headingPart !== "_preamble") {
    const available = headings.map((h) => `  - ${h.headingId || h.tapeIndex}: "${(h.text ?? "").trim()}" (${h.namedStyleType})`).slice(0, 15).join(`
`);
    return `Heading '${headingPart}' does not exist in this document.
Available headings:
${available || "  (none)"}`;
  }
  const checksum = parts[parts.length - 1];
  const nodeWithChecksum = nodes.find((n) => n.scopedId?.includes(`.${checksum}`) && n.scopedId !== atStr);
  if (nodeWithChecksum?.scopedId) {
    return `Node '${checksum}' not found under section '${headingPart}', but found at '${nodeWithChecksum.scopedId}'. Did this section move?`;
  }
  const sectionNodes = targetHeading ? neighborhoodFrom(nodes, targetHeading.tapeIndex) : nodes.slice(0, 10);
  const current = sectionNodes.map((n) => `  - ${n.scopedId ?? n.tapeIndex} (${n.namedStyleType ?? n.kind}${n.bullet ? `[bullet${n.bullet.nestingLevel ? `:${n.bullet.nestingLevel}` : ""}]` : ""}): "${previewText(n.text ?? "")}"`).slice(0, 15).join(`
`);
  return `Node '${atStr}' not found under section '${headingPart}'.
Current nodes in this section:
${current || "  (none)"}`;
}
var formatMissingScopedTargetMsg = missingScopedTargetMsgFormat;
function neighborhoodFrom(nodes, startId, opts) {
  const start = findNodeAt(nodes, startId);
  if (!start)
    throw new Error(missingNodeIdMsg(startId, nodes.length));
  const i = nodes.indexOf(start);
  if (start.kind === "table") {
    return tableCellsAsNodes(start);
  }
  if (start.bullet) {
    const listId = start.bullet.listId;
    const startLevel2 = start.bullet.nestingLevel ?? 0;
    const out2 = [start];
    for (let j = i + 1;j < nodes.length; j++) {
      const n = nodes[j];
      if (!n.bullet || listId && n.bullet.listId !== listId)
        break;
      if (opts?.sameList) {
        out2.push(n);
      } else {
        if ((n.bullet.nestingLevel ?? 0) <= startLevel2)
          break;
        out2.push(n);
      }
    }
    return out2;
  }
  const startLevel = headingLevel(start);
  const out = [start];
  for (let j = i + 1;j < nodes.length; j++) {
    const n = nodes[j];
    if (isHeading(n) && headingLevel(n) <= startLevel)
      break;
    out.push(n);
  }
  return out;
}

class DocDom {
  documentId;
  nodes;
  revisionId;
  title;
  constructor(tape) {
    if (Array.isArray(tape)) {
      this.documentId = "";
      this.nodes = tape;
      this.title = "";
    } else {
      this.documentId = tape.documentId;
      this.nodes = tape.nodes;
      this.revisionId = tape.revisionId;
      this.title = tape.title;
    }
  }
  static from(source) {
    return new DocDom(parseTape(source));
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  querySelectorAll(sel) {
    return querySelectorAll(this.nodes, sel);
  }
  queryFrom(start, select) {
    return queryFrom(this.nodes, start, select);
  }
  nextElementSibling(node) {
    return nextElementSibling(this.nodes, node);
  }
  previousElementSibling(node) {
    return previousElementSibling(this.nodes, node);
  }
  findHeadingsByText(needle, opts) {
    return findHeadingsByText(this.nodes, needle, opts);
  }
  findNodesByText(needle, opts) {
    return findNodesByText(this.nodes, needle, opts);
  }
}
function nodesQueryAll(nodes, sel) {
  const steps = parseSelector(sel);
  const first = steps[0];
  if (!first)
    return [];
  assertRelativeNthOnRest(first.compound);
  const candidates = nodes.filter((n) => matchesCompound(nodes, n, first.compound));
  return walkCompounds(nodes, candidates, steps.slice(1));
}
var querySelectorAll = nodesQueryAll;
function nodesQueryFrom(nodes, start, select) {
  const steps = parseSelector(select);
  const first = steps[0];
  if (!first)
    return [];
  assertRelativeNthOnRest(first.compound);
  if (!matchesCompound(nodes, start, first.compound)) {
    throw new Error(`No match for "${select}" starting at node ${start.tapeIndex}:${previewText(start.text ?? "")}. Use a sibling selector from that node (e.g. HEADING_2 + NORMAL_TEXT or + *).`);
  }
  return walkCompounds(nodes, [start], steps.slice(1));
}
var queryFrom = nodesQueryFrom;
function headingIs(node) {
  return node.kind === "paragraph" && isHeadingStyle(node.namedStyleType);
}
var isHeading = headingIs;
function headingLevelOf(node) {
  return STYLE_TO_LEVEL[node.namedStyleType ?? "NORMAL_TEXT"] ?? 99;
}
var headingLevel = headingLevelOf;
function walkCompounds(nodes, start, rest) {
  let candidates = start;
  for (const step of rest) {
    const combinator = step.combinator ?? "+";
    const compound = step.compound;
    if (combinator === "~" && compound.nthSibling != null) {
      throw new Error(":nth-sibling(n) counts every following sibling (for +). With ~, use :nth(n) among matches.");
    }
    if (combinator === "+" && compound.nth != null) {
      throw new Error(":nth(n) is for ~ (among matching following siblings). With +, use :nth-sibling(n).");
    }
    const next = [];
    const seen = new Set;
    for (const a of candidates) {
      const hits = combinator === "~" ? followingMatches(nodes, a, compound) : adjacentMatch(nodes, a, compound);
      for (const sib of hits) {
        if (seen.has(sib.tapeIndex))
          continue;
        seen.add(sib.tapeIndex);
        next.push(sib);
      }
    }
    candidates = next;
  }
  return candidates;
}
function adjacentMatch(nodes, a, compound) {
  const steps = compound.nthSibling ?? 1;
  let sib = a;
  for (let s = 0;s < steps; s++) {
    sib = nextElementSibling(nodes, sib);
    if (!sib)
      return [];
  }
  if (!sib || !matchesCompound(nodes, sib, compound))
    return [];
  return [sib];
}
function followingMatches(nodes, a, compound) {
  const matches = [];
  const stopLevel = headingLevel(a);
  let sib = nextElementSibling(nodes, a);
  while (sib) {
    if (isHeading(sib) && headingLevel(sib) <= stopLevel)
      break;
    if (matchesCompound(nodes, sib, compound))
      matches.push(sib);
    sib = nextElementSibling(nodes, sib);
  }
  if (compound.nth != null) {
    const hit = matches[compound.nth - 1];
    return hit ? [hit] : [];
  }
  return matches;
}
function assertRelativeNthOnRest(compound) {
  if (compound.nthSibling != null || compound.nth != null) {
    throw new Error(RELATIVE_NTH_MSG);
  }
}
function previewText(text) {
  const one = text.split(/\s+/).join(" ").trim();
  return one.length <= 40 ? one : `${one.slice(0, 39)}…`;
}
function nextElementSibling(nodes, node) {
  const i = indexOfNode(nodes, node);
  if (i < 0)
    return null;
  return nodes[i + 1] ?? null;
}
function previousElementSibling(nodes, node) {
  const i = indexOfNode(nodes, node);
  if (i <= 0)
    return null;
  return nodes[i - 1] ?? null;
}
function headingsByTextFind(nodes, needle, opts = {}) {
  const headings = nodes.filter((n2) => isHeading(n2));
  if (opts.at !== undefined) {
    const hit = headings.find((h) => h.tapeIndex === opts.at);
    if (!hit)
      throw new Error(missingNodeIdMsg(opts.at, nodes.length, "heading"));
    return hit;
  }
  const n = normalize(needle);
  let hits = headings.filter((h) => {
    const t = normalize(h.text ?? "");
    if (opts.match === "exact")
      return t === n;
    return t.includes(n);
  });
  if (!hits.length)
    throw new Error(`Section not found: ${needle}`);
  if (opts.match !== "substr") {
    const exact = hits.filter((h) => normalize(h.text ?? "") === n);
    if (opts.match === "exact")
      hits = exact;
    else if (exact.length)
      hits = exact;
  }
  const sameTitle = new Set(hits.map((h) => normalize(h.text ?? ""))).size === 1;
  if (!sameTitle && hits.length > 1) {
    throw new Error(`Ambiguous heading "${needle}" matches ${hits.length} headings (${hits.map((h) => `${h.start}:${h.text || "(empty)"}`).join("; ")}). Use the exact title or at:<id> from query.`);
  }
  const ranked = [...hits].sort((a, b2) => headingLevel(a) - headingLevel(b2) || a.start - b2.start);
  const shallow = headingLevel(ranked[0]);
  const atShallow = ranked.filter((h) => headingLevel(h) === shallow);
  if (atShallow.length > 1) {
    throw new Error(`Duplicate heading "${needle}" (${atShallow.length} matches at level ${shallow}: ${atShallow.map((h) => String(h.tapeIndex)).join(", ")}). Pass at:<id> from query.`);
  }
  return ranked[0];
}
var findHeadingsByText = headingsByTextFind;
function nodesByTextFind(nodes, needle, opts = {}) {
  const paras = nodes.filter((n2) => n2.kind === "paragraph");
  if (opts.at !== undefined) {
    const hit = paras.find((p) => p.tapeIndex === opts.at);
    if (!hit)
      throw new Error(missingNodeIdMsg(opts.at, nodes.length));
    return hit;
  }
  const n = normalize(needle);
  let hits = paras.filter((p) => {
    const t = normalize(p.text ?? "");
    if (opts.match === "exact")
      return t === n;
    return t.includes(n);
  });
  if (!hits.length)
    throw new Error(`Not found: ${needle}`);
  if (opts.match !== "substr") {
    const exact = hits.filter((h) => normalize(h.text ?? "") === n);
    if (opts.match === "exact")
      hits = exact;
    else if (exact.length)
      hits = exact;
  }
  if (hits.length > 1) {
    throw new Error(`Ambiguous text "${needle}" matches ${hits.length} nodes (${hits.map((h) => `${h.tapeIndex}:${previewText(h.text ?? "")}`).join("; ")}). Use at from query.`);
  }
  return hits[0];
}
var findNodesByText = nodesByTextFind;
function tableCellsAsNodes(tableNode) {
  if (tableNode.kind !== "table" || !tableNode.table)
    return [tableNode];
  const out = [];
  for (let r = 0;r < tableNode.table.cells.length; r++) {
    const row = tableNode.table.cells[r] ?? [];
    for (let c = 0;c < row.length; c++) {
      const cell = row[c];
      if (!cell)
        continue;
      const cellNode = {
        alignment: cell.alignment,
        col: c,
        end: cell.end,
        ...cell.fontColors?.length ? { fontColors: cell.fontColors } : {},
        kind: "paragraph",
        markup: cell.markup,
        row: r,
        scopedId: cell.scopedId,
        shading: cell.shading ?? cell.backgroundColor,
        start: cell.start,
        style: cell.style,
        tapeIndex: tableNode.tapeIndex,
        text: cell.text
      };
      out.push(cellNode);
    }
  }
  return out;
}
function parseSelector(input) {
  const trimmed = input.trim();
  if (!trimmed)
    throw new Error("Empty selector");
  return splitByCombinator(trimmed).map(({ combinator, raw }) => ({
    combinator,
    compound: parseCompound(raw)
  }));
}
function splitByCombinator(input) {
  const parts = [];
  let buf = "";
  let depthSq = 0;
  let depthPar = 0;
  let pending = null;
  const flush = () => {
    const part = buf.trim();
    if (!part)
      throw new Error(`Invalid selector: ${input}`);
    parts.push({ combinator: pending, raw: part });
    buf = "";
  };
  for (let i = 0;i < input.length; i++) {
    const ch = input[i];
    if (ch === "[")
      depthSq++;
    if (ch === "]")
      depthSq = Math.max(0, depthSq - 1);
    if (ch === "(")
      depthPar++;
    if (ch === ")")
      depthPar = Math.max(0, depthPar - 1);
    if ((ch === "+" || ch === "~") && depthSq === 0 && depthPar === 0) {
      flush();
      pending = ch;
      continue;
    }
    if (/\s/.test(ch) && depthSq === 0 && depthPar === 0) {
      let j = i;
      while (j < input.length && /\s/.test(input[j]))
        j++;
      const next = input[j];
      if (next && next !== "+" && next !== "~" && buf.trim()) {
        throw new Error(`Descendant combinator is not supported (Google Docs body is a sibling tape): ${input}`);
      }
      i = j - 1;
      continue;
    }
    buf += ch;
  }
  flush();
  return parts;
}
function parseCompound(raw) {
  let type;
  let rest = raw;
  if (raw[0] === "*") {
    type = "*";
    rest = raw.slice(1);
  } else if (raw[0] !== "[" && raw[0] !== ":") {
    const typeMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(raw);
    if (!typeMatch)
      throw new Error(`Invalid selector: ${raw}`);
    type = typeMatch[0];
    rest = raw.slice(type.length);
    if (type !== "heading" && !KIND_TYPES.has(type) && !NAMED_TYPES.has(type)) {
      throw new Error(`Unknown selector type: ${type}`);
    }
  }
  const compound = { type };
  let pos = 0;
  while (pos < rest.length) {
    pos = consumeExtra(rest, pos, compound, raw);
  }
  return compound;
}
function consumeExtra(rest, pos, compound, raw) {
  const slice = rest.slice(pos);
  const bulletLevelMatch = /^\[bullet:(\d+)\]/.exec(slice);
  if (bulletLevelMatch) {
    if (compound.hasBullet === false) {
      throw new Error(`Conflicting bullet filters: ${raw}`);
    }
    compound.hasBullet = true;
    compound.nestingLevel = Number(bulletLevelMatch[1]);
    return pos + bulletLevelMatch[0].length;
  }
  const levelAttrMatch = /^\[(?:nesting[lL]evel|level)=\s*(\d+)\s*\]/.exec(slice);
  if (levelAttrMatch) {
    if (compound.hasBullet === false) {
      throw new Error(`Conflicting bullet filters: ${raw}`);
    }
    compound.hasBullet = true;
    compound.nestingLevel = Number(levelAttrMatch[1]);
    return pos + levelAttrMatch[0].length;
  }
  const levelPseudoMatch = /^:level\(\s*(\d+)\s*\)/.exec(slice);
  if (levelPseudoMatch) {
    if (compound.hasBullet === false) {
      throw new Error(`Conflicting bullet filters: ${raw}`);
    }
    compound.hasBullet = true;
    compound.nestingLevel = Number(levelPseudoMatch[1]);
    return pos + levelPseudoMatch[0].length;
  }
  if (slice.startsWith("[bullet]")) {
    if (compound.hasBullet === false) {
      throw new Error(`Conflicting bullet filters: ${raw}`);
    }
    compound.hasBullet = true;
    return pos + 8;
  }
  const notBullet = /^:not\(\s*\[bullet\]\s*\)/.exec(slice);
  if (notBullet) {
    if (compound.hasBullet === true) {
      throw new Error(`Conflicting bullet filters: ${raw}`);
    }
    compound.hasBullet = false;
    return pos + notBullet[0].length;
  }
  if (slice.startsWith("[image]")) {
    if (compound.hasImage === false) {
      throw new Error(`Conflicting image filters: ${raw}`);
    }
    compound.hasImage = true;
    return pos + 7;
  }
  const notImage = /^:not\(\s*\[image\]\s*\)/.exec(slice);
  if (notImage) {
    if (compound.hasImage === true) {
      throw new Error(`Conflicting image filters: ${raw}`);
    }
    compound.hasImage = false;
    return pos + notImage[0].length;
  }
  if (slice.startsWith(":empty")) {
    compound.empty = true;
    return pos + 6;
  }
  if (slice.startsWith(":last-of-type")) {
    compound.lastOfType = true;
    return pos + 13;
  }
  if (slice.startsWith(":last-child")) {
    compound.lastChild = true;
    return pos + 11;
  }
  if (slice.startsWith(":first-of-type")) {
    compound.nthOfType = 1;
    return pos + 14;
  }
  const nthType = /^:nth-of-type\(\s*(\d+)\s*\)/.exec(slice);
  if (nthType) {
    const n = Number(nthType[1]);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`:nth-of-type() requires a 1-based integer: ${raw}`);
    }
    compound.nthOfType = n;
    return pos + nthType[0].length;
  }
  const nthSib = /^:nth-sibling\(\s*(\d+)\s*\)/.exec(slice);
  if (nthSib) {
    const n = Number(nthSib[1]);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`:nth-sibling() requires a 1-based integer: ${raw}`);
    }
    if (compound.nth != null) {
      throw new Error(`:nth(n) and :nth-sibling(n) cannot be combined: ${raw}`);
    }
    compound.nthSibling = n;
    return pos + nthSib[0].length;
  }
  const nthMatch = /^:nth\(\s*(\d+)\s*\)/.exec(slice);
  if (nthMatch) {
    const n = Number(nthMatch[1]);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`:nth() requires a 1-based integer: ${raw}`);
    }
    if (compound.nthSibling != null) {
      throw new Error(`:nth(n) and :nth-sibling(n) cannot be combined: ${raw}`);
    }
    compound.nth = n;
    return pos + nthMatch[0].length;
  }
  const contains = /^:contains\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+))\s*\)/.exec(slice);
  if (contains) {
    compound.contains = (contains[1] ?? contains[2] ?? contains[3]).trim();
    return pos + contains[0].length;
  }
  throw new Error(`Invalid selector: ${raw}`);
}
function matchesCompound(nodes, node, c) {
  if (!matchesType(node, c.type))
    return false;
  if (c.hasBullet === true && !node.bullet)
    return false;
  if (c.hasBullet === false && node.bullet)
    return false;
  if (c.nestingLevel != null) {
    if (!node.bullet || (node.bullet.nestingLevel ?? 0) !== c.nestingLevel)
      return false;
  }
  if (c.hasImage === true && !node.images?.length)
    return false;
  if (c.hasImage === false && node.images?.length)
    return false;
  if (c.empty) {
    if (node.kind !== "paragraph")
      return false;
    if ((node.text ?? "").trim() !== "")
      return false;
    if (node.images?.length)
      return false;
    if (node.chips?.length)
      return false;
  }
  if (c.contains != null) {
    if (!normalize(node.text ?? "").includes(normalize(c.contains)))
      return false;
  }
  if (c.lastChild) {
    if (nodes.at(-1)?.tapeIndex !== node.tapeIndex)
      return false;
  }
  if (c.nthOfType != null && ofTypeIndex(nodes, node, c.type) !== c.nthOfType) {
    return false;
  }
  if (c.lastOfType) {
    const idx = ofTypeIndex(nodes, node, c.type);
    let count = 0;
    for (const cand of nodes) {
      if (c.type) {
        if (!matchesType(cand, c.type))
          continue;
      } else if (cand.kind !== node.kind) {
        continue;
      }
      count++;
    }
    if (idx !== count)
      return false;
  }
  return true;
}
function matchesType(node, type) {
  if (!type || type === "*")
    return true;
  if (type === "heading")
    return isHeading(node);
  if (KIND_TYPES.has(type))
    return node.kind === type;
  return node.namedStyleType === type;
}
function ofTypeIndex(nodes, node, type) {
  let n = 0;
  for (const cand of nodes) {
    if (type) {
      if (!matchesType(cand, type))
        continue;
    } else if (cand.kind !== node.kind) {
      continue;
    }
    n++;
    if (cand.tapeIndex === node.tapeIndex)
      return n;
  }
  return n;
}
function indexOfNode(nodes, node) {
  return nodes.findIndex((n) => n.tapeIndex === node.tapeIndex);
}
function normalize(s) {
  return s.split(/\s+/).join(" ").toLowerCase();
}

// src/core/dom/clone.ts
async function cloneNodeOpsResolve(ops, context) {
  const loadedByDocId = new Map;
  if (context.defaultDoc) {
    loadedByDocId.set(context.defaultDocumentId, context.defaultDoc);
  }
  async function getDoc(docId) {
    if (!loadedByDocId.has(docId)) {
      const loaded = await Gdoc.load(docId, context.client);
      loadedByDocId.set(docId, loaded);
    }
    return loadedByDocId.get(docId);
  }
  for (let i = 0;i < ops.length; i++) {
    const op = ops[i];
    if (!op.insertAdjacentElement)
      continue;
    const adj = op.insertAdjacentElement;
    const refs = [];
    if (adj.cloneNode != null) {
      if (typeof adj.cloneNode === "object") {
        refs.push(adj.cloneNode);
      } else {
        refs.push({ nodeId: adj.cloneNode });
      }
    }
    if (Array.isArray(adj.cloneNodes)) {
      for (const item of adj.cloneNodes) {
        if (typeof item === "object") {
          refs.push(item);
        } else {
          refs.push({ nodeId: item });
        }
      }
    }
    if (!refs.length)
      continue;
    const resolvedSpecs = [];
    for (const ref of refs) {
      const docId = ref.fromDoc ?? context.defaultDocumentId;
      const rawGdoc = await getDoc(docId);
      const tabRef = ref.fromTab ?? (docId === context.defaultDocumentId ? context.defaultTabId : undefined);
      const liveTab = resolveApplyTab(rawGdoc.data, tabRef);
      const targetGdoc = liveTab.tabId ? rawGdoc.withTab(liveTab.tabId) : rawGdoc;
      const parsed = parseDocument(targetGdoc);
      const targetId = ref.nodeId ?? ref.fromNode;
      if (targetId == null) {
        throw new Error(`ops[${i}] cloneNode requires a heading-scoped id, got ${JSON.stringify(ref)}`);
      }
      const node = findNodeAt(parsed.nodes, targetId);
      if (!node) {
        throw new Error(`ops[${i}] cloneNode: ${missingNodeIdMsg(targetId, parsed.nodes.length)} (doc "${docId}" tab "${liveTab.tabId ?? "default"}")`);
      }
      const spec = elementSpecFromNode(node, { innerText: ref.innerText });
      resolvedSpecs.push(spec);
    }
    const existingElements = Array.isArray(adj.elements) ? adj.elements : adj.element ? [adj.element] : [];
    adj.elements = [...existingElements, ...resolvedSpecs];
    delete adj.element;
    delete adj.cloneNode;
    delete adj.cloneNodes;
  }
}
function elementSpecFromNode(node, options) {
  if (node.kind === "paragraph") {
    const warnings = [];
    const sourceText = options?.innerText ?? (node.chips?.length || node.images?.length ? node.text ?? "" : node.markup ?? node.text ?? "");
    const plan = paragraphInlineClone({ chips: node.chips, images: node.images, text: sourceText });
    let text = plan.text;
    warnings.push(...plan.unclonable.map((msg) => `Node ${node.tapeIndex}: ${msg}`));
    if (plan.unclonable.some((msg) => msg.includes("inline image")) && !text.includes("[Image]")) {
      text = text.trim() ? `${text} [Image]` : "[Image]";
    }
    if (node.footnoteIds?.length) {
      warnings.push(`Node ${node.tapeIndex}: ${node.footnoteIds.length} footnote(s) omitted because Google Docs API cannot clone footnote bodies atomically.`);
    }
    const stylePatch = { ...node.style ?? {} };
    if (node.shading)
      stylePatch.shading = node.shading;
    if (node.spaceAbove != null)
      stylePatch.spaceAbove = node.spaceAbove;
    if (node.spaceBelow != null)
      stylePatch.spaceBelow = node.spaceBelow;
    if (node.lineSpacing != null)
      stylePatch.lineSpacing = node.lineSpacing;
    if (node.indentEnd?.magnitude != null)
      stylePatch.indentEnd = node.indentEnd.magnitude;
    if (node.indentFirstLine?.magnitude != null) {
      stylePatch.indentFirstLine = node.indentFirstLine.magnitude;
    }
    const spec = {
      kind: "paragraph",
      namedStyleType: node.namedStyleType ?? "NORMAL_TEXT",
      text
    };
    if (plan.specials.length > 0)
      spec.specials = plan.specials;
    if (node.alignment)
      spec.alignment = node.alignment;
    if (Object.keys(stylePatch).length > 0)
      spec.style = stylePatch;
    if (node.indentStart?.magnitude != null) {
      spec.indentStart = {
        magnitude: node.indentStart.magnitude,
        unit: "PT"
      };
    }
    if (node.bullet) {
      const preset = node.bullet.type === "CHECKBOX" ? "BULLET_CHECKBOX" : node.bullet.type === "NUMBERED" ? "NUMBERED_DECIMAL_NESTED" : "BULLET_DISC_CIRCLE_SQUARE";
      spec.bullet = {
        nestingLevel: node.bullet.nestingLevel,
        preset
      };
    }
    if (warnings.length > 0)
      spec.warnings = warnings;
    return spec;
  }
  if (node.kind === "table" && node.table) {
    const warnings = [];
    const cellSpecials = [];
    const rows = node.table.cells.map((row) => {
      const specialsRow = [];
      const texts = row.map((cell) => {
        const plan = tableCellInlineClone(cell);
        warnings.push(...plan.unclonable.map((msg) => `Node ${node.tapeIndex} table: ${msg}`));
        specialsRow.push(plan.specials.length > 0 ? plan.specials : undefined);
        return plan.text;
      });
      cellSpecials.push(specialsRow);
      return texts;
    });
    const spec = {
      kind: "table",
      table: { rows }
    };
    if (cellSpecials.some((row) => row.some((s) => s?.length))) {
      spec.table.cellSpecials = cellSpecials;
    }
    if (warnings.length > 0)
      spec.warnings = warnings;
    return spec;
  }
  if (node.kind === "pageBreak") {
    return { kind: "pageBreak" };
  }
  if (node.kind === "tableOfContents") {
    throw new Error(`Cannot clone node ${node.tapeIndex} of kind "tableOfContents": Google Docs REST API does not support inserting or duplicating Table of Contents. Create it via Insert > Table of contents in Google Docs UI.`);
  }
  if (node.kind === "sectionBreak") {
    throw new Error(`Cannot clone node ${node.tapeIndex} of kind "sectionBreak": Section breaks cannot be cloned detachedly via insertAdjacentElement because they govern page setups, margins, and header/footer bindings.`);
  }
  throw new Error(`Cannot clone node ${node.tapeIndex} of unsupported kind "${node.kind}"`);
}
function intraDocCloneNodeResolve(ref, nodes) {
  const idRaw = typeof ref === "object" ? ref.nodeId ?? ref.fromNode : ref;
  if (idRaw == null) {
    throw new Error(`cloneNode requires a heading-scoped id, got: ${JSON.stringify(ref)}`);
  }
  const found = findNodeAt(nodes, idRaw);
  if (!found) {
    throw new Error(`cloneNode: ${missingNodeIdMsg(idRaw, nodes.length)}`);
  }
  const innerText = typeof ref === "object" ? ref.innerText : undefined;
  return elementSpecFromNode(found, { innerText });
}
var resolveIntraDocCloneNode = intraDocCloneNodeResolve;

// src/core/dom/element.ts
var BULLET_GLYPH_PRESETS = [
  "BULLET_DISC_CIRCLE_SQUARE",
  "BULLET_DIAMONDX_ARROW3D_SQUARE",
  "BULLET_CHECKBOX",
  "BULLET_ARROW_DIAMOND_DISC",
  "BULLET_STAR_CIRCLE_SQUARE",
  "BULLET_ARROW3D_CIRCLE_SQUARE",
  "BULLET_LEFTTRIANGLE_DIAMOND_DISC",
  "BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE",
  "BULLET_DIAMOND_CIRCLE_SQUARE",
  "NUMBERED_DECIMAL_ALPHA_ROMAN",
  "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS",
  "NUMBERED_DECIMAL_NESTED",
  "NUMBERED_UPPERALPHA_ALPHA_ROMAN",
  "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL",
  "NUMBERED_ZERODECIMAL_ALPHA_ROMAN"
];
function bulletPresetAs(value) {
  return PRESET_SET.has(value) ? value : undefined;
}
var asBulletPreset = bulletPresetAs;
function codeBlockCreate(props, opts) {
  const stripped = trailingNewlineStrip(props.text ?? "");
  const lines = stripped.split(`
`);
  const count = lines.length;
  return lines.map((line, idx) => {
    const isLast = idx === count - 1;
    const baseStyle = {
      fontFamily: "Courier New",
      fontSize: 10,
      lineSpacing: 100,
      ...isLast ? {} : { spaceBelow: 0 },
      ...props.style ?? {}
    };
    if (!isLast && props.style?.spaceBelow === undefined) {
      baseStyle.spaceBelow = 0;
    }
    const spec = {
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      style: baseStyle,
      text: line
    };
    if (props.alignment)
      spec.alignment = props.alignment;
    assertWritable(spec, opts);
    return spec;
  });
}
var createCodeBlock = codeBlockCreate;
function elementCreate(kind, props = {}, opts) {
  const pRecord = props && typeof props === "object" ? props : {};
  if (UNSUPPORTED_KINDS[kind]) {
    throw new Error(`Cannot create "${kind}": ${UNSUPPORTED_KINDS[kind]}`);
  }
  if (KIND_ALIASES.has(kind)) {
    throw new Error(`Unknown kind "${kind}". Use createElement("paragraph", { namedStyleType, text }), "codeBlock", or "table". No p/q/ul/ol aliases.`);
  }
  if (kind === "pageBreak") {
    return { kind: "pageBreak" };
  }
  if (kind === "sectionBreak") {
    const sp = pRecord;
    return { kind: "sectionBreak", sectionType: sp.sectionType ?? "NEXT_PAGE" };
  }
  if (kind === "person") {
    const pp = pRecord;
    if (!pp.email)
      throw new Error('person chip requires "email"');
    return { email: pp.email, kind: "person" };
  }
  if (kind === "richLink") {
    const rp = pRecord;
    if (!rp.uri)
      throw new Error('richLink requires "uri"');
    return {
      kind: "richLink",
      ...rp.mimeType ? { mimeType: rp.mimeType } : {},
      ...rp.title ? { title: rp.title } : {},
      uri: rp.uri
    };
  }
  if (kind === "date") {
    const dp = pRecord;
    return {
      kind: "date",
      ...dp.dateFormat ? { dateFormat: dp.dateFormat } : {},
      ...dp.displayText ? { displayText: dp.displayText } : {},
      ...dp.timestamp ? { timestamp: dp.timestamp } : {}
    };
  }
  if (kind === "footnote") {
    const fp = pRecord;
    return {
      kind: "footnote",
      ...fp.text ? { text: fp.text } : {}
    };
  }
  if (kind === "inlineImage") {
    const ip = pRecord;
    if (!ip.uri)
      throw new Error('inlineImage requires "uri"');
    return {
      kind: "inlineImage",
      ...ip.heightPt != null ? { heightPt: ip.heightPt } : {},
      uri: ip.uri,
      ...ip.widthPt != null ? { widthPt: ip.widthPt } : {}
    };
  }
  if (kind === "codeBlock") {
    const cp = props;
    const baseStyle = {
      fontFamily: "Courier New",
      fontSize: 10,
      lineSpacing: 100,
      ...cp.style ?? {}
    };
    const spec2 = {
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      style: baseStyle,
      text: trailingNewlineStrip(cp.text ?? "")
    };
    if (cp.alignment)
      spec2.alignment = cp.alignment;
    return spec2;
  }
  if (kind === "table") {
    const tp = props;
    const rows = tp.rows;
    if (!rows?.length)
      throw new Error("table requires at least one row");
    const spec2 = {
      kind: "table",
      table: { rows: rows.map((row) => row.map(String)) }
    };
    if (tp.cellSpecials?.length)
      spec2.table.cellSpecials = tp.cellSpecials;
    if (tp.warnings?.length)
      spec2.warnings = tp.warnings;
    return spec2;
  }
  if (kind !== "paragraph") {
    throw new Error(`Unknown kind "${kind}". Use "paragraph", "codeBlock", "table", or "pageBreak".`);
  }
  const p = props;
  if (!p.namedStyleType) {
    throw new Error("paragraph requires namedStyleType (NORMAL_TEXT, HEADING_*, TITLE, SUBTITLE)");
  }
  const spec = {
    kind: "paragraph",
    namedStyleType: p.namedStyleType,
    text: trailingNewlineStrip(p.text ?? "")
  };
  if (p.runs?.length)
    spec.runs = p.runs;
  if (p.specials?.length)
    spec.specials = p.specials;
  if (p.alignment)
    spec.alignment = p.alignment;
  if (p.warnings?.length)
    spec.warnings = p.warnings;
  if (p.style && Object.keys(p.style).length)
    spec.style = p.style;
  if (p.bullet) {
    const bulletObj = typeof p.bullet === "boolean" ? {} : p.bullet;
    const preset = bulletPresetAs(bulletObj.preset ?? "BULLET_DISC_CIRCLE_SQUARE");
    if (!preset) {
      throw new Error(`Unknown bullet preset "${bulletObj.preset}". Use a Docs BulletGlyphPreset (NUMBERED_* / BULLET_*).`);
    }
    spec.bullet = {
      nestingLevel: bulletObj.nestingLevel ?? 0,
      preset
    };
  }
  const indent = indentNormalize(p.indentStart) ?? indentNormalize(p.style?.indentStart);
  if (indent)
    spec.indentStart = indent;
  assertWritable(spec, opts);
  return spec;
}
var createElement = elementCreate;
function indentNormalize(indent) {
  if (indent === undefined)
    return;
  if (typeof indent === "number")
    return { magnitude: indent, unit: "PT" };
  return { magnitude: indent.magnitude, unit: "PT" };
}
function trailingNewlineStrip(text) {
  return text.replace(/\n$/, "");
}
var stripTrailingNewline = trailingNewlineStrip;
var KIND_ALIASES = new Set(["ol", "p", "q", "ul"]);
var PRESET_SET = new Set(BULLET_GLYPH_PRESETS);
var UNSUPPORTED_KINDS = {
  bookmark: "Bookmarks cannot be inserted via REST API (read-only in Docs API).",
  columnBreak: "columnBreak cannot be inserted via REST API (Google Docs has no InsertColumnBreakRequest). Use sectionBreak with columnCount instead.",
  drawing: "Google Drawings cannot be created via REST API.",
  equation: "Math equations cannot be inserted via REST API (read-only in Docs API).",
  horizontalRule: "Horizontal rules cannot be inserted via REST API (Docs API has no insert request). Use paragraph bottom border instead.",
  hr: "Horizontal rules cannot be inserted via REST API (Docs API has no insert request). Use paragraph bottom border instead.",
  math: "Math equations cannot be inserted via REST API (read-only in Docs API).",
  tableOfContents: "Table of Contents cannot be created or updated via REST API.",
  toc: "Table of Contents cannot be created or updated via REST API."
};

// src/core/dom/linkResolver.ts
function symbolicLinkResolverCreate(ctx) {
  return (href) => symbolicLinkResolve(href, ctx);
}
var createSymbolicLinkResolver = symbolicLinkResolverCreate;
function markdownSymbolicLinksResolve(markdown, resolver) {
  if (!resolver || !markdown)
    return markdown;
  return markdown.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\r\n]+`)|\[(?<label>[^\]\r\n]+)\]\((?:<(?<angledHref>(?:tab:|[#])[^>\r\n]+)>|(?<rawHref>(?:tab:|[#])[^)\r\n]+))\)/g, (match, code, label, angledHref, rawHref) => {
    if (code)
      return code;
    const targetHref = (angledHref ?? rawHref ?? "").trim();
    if (!targetHref)
      return match;
    const resolved = resolver(targetHref);
    return `[${label}](${resolved})`;
  });
}
function symbolicLinkResolve(href, ctx) {
  if (!href)
    return href;
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("/") || href.startsWith("?tab=") || href.startsWith("#heading=h.")) {
    return href;
  }
  if (href.startsWith("tab:")) {
    const rawTarget = href.slice(4).trim();
    const hashIndex = rawTarget.indexOf("#");
    const tabHint = (hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget).trim();
    const headingHint = (hashIndex >= 0 ? rawTarget.slice(hashIndex + 1) : "").trim();
    if (!tabHint) {
      throw new Error(`Invalid symbolic link "${href}": tab title or ID is required.`);
    }
    if (!ctx?.doc) {
      return href;
    }
    const resolvedTab = resolveTab(ctx.doc, tabHint);
    const tabId = resolvedTab.tabId;
    if (!tabId) {
      throw new Error(`Cannot resolve symbolic link "${href}": document has no tab matching "${tabHint}".`);
    }
    if (!headingHint) {
      return `?tab=${tabId}`;
    }
    if (headingHint.startsWith("h.") && !headingHint.includes(" ")) {
      return `?tab=${tabId}#heading=${headingHint}`;
    }
    const nodes = tabNodesExtract(ctx, tabId);
    const hit = headingByTitleOrSlugFind(nodes, headingHint) ?? nodeAtFind(nodes, headingHint);
    if (!hit) {
      const known = nodes.filter((n) => isHeading(n)).map((h) => `"${(h.text ?? "").trim()}"`).filter(Boolean).join(", ");
      throw new Error(`Cannot resolve symbolic link "${href}": heading "${headingHint}" not found in tab "${resolvedTab.title || tabId}".${known ? ` Known headings: ${known}` : ""}`);
    }
    const headingId = nodeHeadingIdResolve(hit);
    return headingId ? `?tab=${tabId}#heading=${headingId}` : `?tab=${tabId}`;
  }
  if (href.startsWith("#")) {
    const headingHint = href.slice(1).trim();
    if (!headingHint || headingHint.startsWith("heading=h.")) {
      return href;
    }
    if (headingHint.startsWith("h.") && !headingHint.includes(" ")) {
      return ctx?.currentTabId ? `?tab=${ctx.currentTabId}#heading=${headingHint}` : `#heading=${headingHint}`;
    }
    if (ctx?.currentTabId) {
      const activeNodes = tabNodesExtract(ctx, ctx.currentTabId);
      const hit = headingByTitleOrSlugFind(activeNodes, headingHint) ?? nodeAtFind(activeNodes, headingHint);
      if (hit) {
        const headingId = nodeHeadingIdResolve(hit);
        return headingId ? `?tab=${ctx.currentTabId}#heading=${headingId}` : `?tab=${ctx.currentTabId}`;
      }
    } else if (ctx?.nodes?.length) {
      const hit = headingByTitleOrSlugFind(ctx.nodes, headingHint) ?? nodeAtFind(ctx.nodes, headingHint);
      if (hit) {
        const headingId = nodeHeadingIdResolve(hit);
        return headingId ? `#heading=${headingId}` : href;
      }
    }
    if (ctx?.doc?.tabs?.length) {
      for (const tab of flattenTabs(ctx.doc.tabs)) {
        if (tab.tabId === ctx.currentTabId)
          continue;
        const nodes = tabNodesExtract(ctx, tab.tabId);
        const hit = headingByTitleOrSlugFind(nodes, headingHint) ?? nodeAtFind(nodes, headingHint);
        if (hit) {
          const headingId = nodeHeadingIdResolve(hit);
          return headingId ? `?tab=${tab.tabId}#heading=${headingId}` : `?tab=${tab.tabId}`;
        }
      }
    }
    if (ctx?.nodes?.length || ctx?.doc) {
      const activeList = ctx?.currentTabId ? tabNodesExtract(ctx, ctx.currentTabId) : ctx?.nodes ?? [];
      const allHeadings = activeList.filter((n) => isHeading(n)).map((h) => `"${(h.text ?? "").trim()}"`).filter(Boolean).join(", ");
      throw new Error(`Cannot resolve heading link "${href}": heading "${headingHint}" not found.${allHeadings ? ` Known headings in active tab: ${allHeadings}` : ""}`);
    }
  }
  return href;
}
function tabNodesExtract(ctx, tabId) {
  if (ctx.simulatedTabs?.has(tabId)) {
    return ctx.simulatedTabs.get(tabId);
  }
  if (ctx.doc?.tabs?.length) {
    const tabGdoc = new Gdoc(ctx.doc, ctx.doc.documentId ?? "doc").withTab(tabId);
    return parseDocument(tabGdoc).nodes;
  }
  if (ctx.nodes && (!ctx.currentTabId || ctx.currentTabId === tabId)) {
    return ctx.nodes;
  }
  return [];
}
function nodeHeadingIdResolve(node) {
  if (node.headingId)
    return node.headingId;
  if (node.scopedId) {
    const headingFromScoped = scopedIdHeadingExtract(node.scopedId);
    if (headingFromScoped && headingFromScoped !== "_preamble")
      return headingFromScoped;
  }
  return typeof node.tapeIndex === "number" ? `h.heading_${node.tapeIndex}` : undefined;
}
function scopedIdHeadingExtract(scopedId) {
  const lastDot = scopedId.lastIndexOf(".");
  if (lastDot <= 0)
    return scopedId;
  return scopedId.slice(0, lastDot);
}

// src/core/dom/markdownParser.ts
function chunkMarkdownElements(specs) {
  const chunks = [];
  let currentElements = [];
  for (const spec of specs) {
    if (spec.kind === "table") {
      if (currentElements.length > 0) {
        chunks.push({ kind: "elements", specs: currentElements });
        currentElements = [];
      }
      chunks.push({ kind: "table", spec });
    } else {
      currentElements.push(spec);
    }
  }
  if (currentElements.length > 0) {
    chunks.push({ kind: "elements", specs: currentElements });
  }
  return chunks;
}
function customStyleNormalize(raw) {
  const style2 = {};
  if (raw.bold === true)
    style2.bold = true;
  if (raw.italic === true)
    style2.italic = true;
  if (raw.underline === true)
    style2.underline = true;
  if (raw.strikethrough === true || raw.strike === true)
    style2.strikethrough = true;
  if (typeof raw.style === "string") {
    const parts = raw.style.toLowerCase().split(/[,\s]+/);
    for (const p of parts) {
      if (p === "bold")
        style2.bold = true;
      if (p === "italic")
        style2.italic = true;
      if (p === "underline")
        style2.underline = true;
      if (p === "strike" || p === "strikethrough")
        style2.strikethrough = true;
    }
  }
  const fg = raw.foregroundColor ?? raw.color;
  if (typeof fg === "string")
    style2.foregroundColor = fg;
  const bg = raw.backgroundColor ?? raw.background ?? raw.highlight;
  if (typeof bg === "string")
    style2.backgroundColor = bg;
  const sz = raw.fontSize ?? raw.size;
  if (typeof sz === "number") {
    style2.fontSize = sz;
  } else if (typeof sz === "string") {
    const n = parseFloat(sz);
    if (!Number.isNaN(n))
      style2.fontSize = n;
  }
  const ff = raw.fontFamily ?? raw.font;
  if (typeof ff === "string")
    style2.fontFamily = ff;
  return style2;
}
function markdownStylesParse(styles) {
  const out = {};
  if (!styles || typeof styles !== "object") {
    return out;
  }
  for (const [name, val] of Object.entries(styles)) {
    if (val && typeof val === "object") {
      out[name] = customStyleNormalize(val);
    }
  }
  return out;
}
function listIndentationNormalize(md) {
  const lines = md.split(`
`);
  const result = [];
  let inCodeBlock = false;
  let listStack = [];
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      listStack = [];
      continue;
    }
    if (inCodeBlock) {
      result.push(line);
      continue;
    }
    if (trimmed === "") {
      result.push(line);
      continue;
    }
    const bqMatch = /^((?:>[ \t]*)+)(.*)$/.exec(line);
    const quotePrefix = bqMatch ? bqMatch[1] : "";
    const lineContent = bqMatch ? bqMatch[2] : line;
    const match = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)(.*)$/.exec(lineContent);
    if (!match) {
      const leadingSpaces = (/^[ \t]*/.exec(lineContent)?.[0] ?? "").replace(/\t/g, "    ").length;
      if (listStack.length > 0 && leadingSpaces > listStack[0]?.indent) {
        const top = listStack[listStack.length - 1];
        result.push(quotePrefix + " ".repeat(top.shift) + lineContent);
        continue;
      }
      listStack = [];
      result.push(line);
      continue;
    }
    const [, indentStr, marker, spaceStr, text] = match;
    const rawIndent = indentStr?.replace(/\t/g, "    ").length;
    const isOrdered = /^\d+[.)]$/.test(marker);
    const markerLen = (marker?.length ?? 0) + (spaceStr?.length ?? 0);
    while (listStack.length > 0 && (listStack[listStack.length - 1]?.indent ?? 0) >= (rawIndent ?? 0)) {
      listStack.pop();
    }
    let currentShift = 0;
    if (listStack.length > 0) {
      const parent = listStack[listStack.length - 1];
      currentShift = parent.shift;
      const effectiveIndent = (rawIndent ?? 0) + currentShift;
      if (effectiveIndent < parent.minChildIndent) {
        const extraShift = parent.minChildIndent - effectiveIndent;
        currentShift += extraShift;
      }
    }
    const newIndent = (rawIndent ?? 0) + currentShift;
    const minChild = newIndent + Math.max(markerLen, isOrdered ? 4 : 2);
    listStack.push({
      indent: rawIndent ?? 0,
      minChildIndent: minChild,
      shift: currentShift
    });
    result.push(quotePrefix + " ".repeat(newIndent) + marker + spaceStr + text);
  }
  return result.join(`
`);
}
function markdownToElementsParse(markdown, options = {}) {
  const resolvedMarkdown = options.linkResolver ? markdownSymbolicLinksResolve(markdown, options.linkResolver) : markdown;
  const effectiveStyles = options.customStyles ?? {};
  const normalizedContent = listIndentationNormalize(resolvedMarkdown);
  const tokens = f.lexer(normalizedContent);
  const elements = [];
  let seenFirstH1 = false;
  function walkTokens(tokenList, context = {}) {
    const bqDepth = context.blockquoteDepth ?? 0;
    for (const token of tokenList) {
      switch (token.type) {
        case "heading": {
          let namedStyleType;
          if (token.depth === 1 && options.h1IsTitle && !seenFirstH1) {
            namedStyleType = "TITLE";
            seenFirstH1 = true;
          } else {
            const depth = Math.min(Math.max(token.depth, 1), 6);
            namedStyleType = `HEADING_${depth}`;
            if (token.depth === 1)
              seenFirstH1 = true;
          }
          elements.push(createElement("paragraph", {
            namedStyleType,
            text: token.text
          }));
          break;
        }
        case "paragraph": {
          const props = {
            namedStyleType: "NORMAL_TEXT",
            text: token.text
          };
          if (Object.keys(effectiveStyles).length > 0) {
            const parsed = InlineMarkup.parse(token.text, effectiveStyles);
            if (parsed.runs.length > 0) {
              props.runs = parsed.runs;
            }
          }
          if (bqDepth > 0) {
            props.style = { indentStart: bqDepth * 18 };
          }
          elements.push(createElement("paragraph", props));
          break;
        }
        case "list": {
          parseListToken(token, 0, bqDepth);
          break;
        }
        case "code": {
          const codeSpecs = createCodeBlock({
            language: token.lang || undefined,
            text: token.text
          });
          if (bqDepth > 0) {
            for (const s of codeSpecs) {
              s.style = { ...s.style, indentStart: bqDepth * 18 };
            }
          }
          elements.push(...codeSpecs);
          break;
        }
        case "table": {
          const tableToken = token;
          const rows = [
            tableToken.header.map((c) => c.text),
            ...tableToken.rows.map((row) => row.map((c) => c.text))
          ];
          elements.push(createElement("table", { rows }));
          break;
        }
        case "blockquote": {
          const bq = token;
          walkTokens(bq.tokens ?? [], {
            ...context,
            blockquoteDepth: bqDepth + 1
          });
          break;
        }
        case "hr": {
          elements.push(createElement("pageBreak"));
          break;
        }
        case "space": {
          break;
        }
        default: {
          if ("tokens" in token && Array.isArray(token.tokens)) {
            walkTokens(token.tokens, context);
          }
          break;
        }
      }
    }
  }
  function parseListToken(list, nestingLevel, blockquoteDepth = 0) {
    const isOrdered = Boolean(list.ordered);
    for (const item of list.items) {
      let preset;
      if (item.task) {
        preset = "BULLET_CHECKBOX";
      } else if (isOrdered) {
        preset = "NUMBERED_DECIMAL_NESTED";
      } else {
        preset = "BULLET_DISC_CIRCLE_SQUARE";
      }
      const indentStart = (blockquoteDepth > 0 ? blockquoteDepth * 18 : 0) + (nestingLevel > 0 ? (nestingLevel + 1) * 36 : 0);
      let firstTextPushed = false;
      const nestedLists = [];
      for (const t of item.tokens) {
        if (t.type === "list") {
          nestedLists.push(t);
        } else if (t.type === "checkbox") {} else if (t.type === "text" || t.type === "paragraph") {
          const text = t.text;
          const props = {
            bullet: {
              nestingLevel,
              preset
            },
            namedStyleType: "NORMAL_TEXT",
            text,
            ...indentStart > 0 ? { indentStart } : {}
          };
          if (Object.keys(effectiveStyles).length > 0) {
            const parsed = InlineMarkup.parse(text, effectiveStyles);
            if (parsed.runs.length > 0) {
              props.runs = parsed.runs;
            }
          }
          elements.push(createElement("paragraph", props));
          firstTextPushed = true;
        }
      }
      if (!firstTextPushed && item.text) {
        const props = {
          bullet: {
            nestingLevel,
            preset
          },
          namedStyleType: "NORMAL_TEXT",
          text: item.text,
          ...indentStart > 0 ? { indentStart } : {}
        };
        if (Object.keys(effectiveStyles).length > 0) {
          const parsed = InlineMarkup.parse(item.text, effectiveStyles);
          if (parsed.runs.length > 0) {
            props.runs = parsed.runs;
          }
        }
        elements.push(createElement("paragraph", props));
      }
      for (const sub of nestedLists) {
        parseListToken(sub, nestingLevel + 1, blockquoteDepth);
      }
    }
  }
  InlineMarkup.withStyles(effectiveStyles, () => {
    InlineMarkup.withLinkResolver(options.linkResolver, () => {
      walkTokens(tokens);
    });
  });
  return elements;
}
var parseMarkdownToElements = markdownToElementsParse;

// src/core/dom/ops.ts
var PREVIEW_LEN = 80;
var TAPE_MUTATION_KEYS = [
  "after",
  "alignment",
  "as",
  "at",
  "before",
  "bullet",
  "cloneNode",
  "cloneNodes",
  "dangerousRemoveSection",
  "deleteTableColumn",
  "deleteTableRow",
  "duplicateTableRow",
  "element",
  "elements",
  "file",
  "force",
  "h1IsTitle",
  "innerText",
  "insertAdjacentElement",
  "insertDate",
  "insertFootnote",
  "insertImage",
  "insertMarkdown",
  "insertPerson",
  "insertRichLink",
  "insertSectionBreak",
  "insertTableColumn",
  "insertTableRow",
  "markdownStyles",
  "namedStyleType",
  "position",
  "remove",
  "replace",
  "replaceMarkdown",
  "replaceSection",
  "runs",
  "style",
  "tableAlignment",
  "tableStyle"
];
var TAPE_ECHO_CAP = 80;
function liveDump(opts) {
  const overCap = opts.nodes.length > TAPE_ECHO_CAP;
  const truncated = overCap && !opts.full;
  const src = truncated ? opts.nodes.filter((n) => isHeadingStyle(n.namedStyleType)) : opts.nodes;
  const tab = {
    nodes: src.map((n) => summarizeNode(n, { full: opts.full })),
    ops: []
  };
  if (opts.tabId)
    tab.tabId = opts.tabId;
  if (opts.tabTitle)
    tab.tabTitle = opts.tabTitle;
  const dump = { ops: [], tabs: [tab] };
  if (opts.documentId)
    dump.documentId = opts.documentId;
  if (truncated)
    dump.truncated = true;
  if (opts.tape)
    dump.tape = opts.tape;
  if (opts.segmentId)
    dump.segmentId = opts.segmentId;
  if (opts.use)
    dump.use = opts.use;
  if (opts.pageSetup)
    dump.pageSetup = opts.pageSetup;
  const nodesToInspect = opts.allNodes ?? opts.nodes;
  const styledNodes = nodesToInspect.filter((n) => n.style != null);
  if (styledNodes.length > 0) {
    dump.customStyledNodes = styledNodes.map((n) => n.scopedId ?? n.tapeIndex);
    if (opts.includeStyles) {
      dump.styles = Object.fromEntries(styledNodes.map((n) => [String(n.scopedId ?? n.tapeIndex), n.style]));
    }
  }
  return dump;
}
function pageSetupExtract(docStyle) {
  if (!docStyle)
    return;
  const top = docStyle.marginTop?.magnitude;
  const bottom = docStyle.marginBottom?.magnitude;
  const left = docStyle.marginLeft?.magnitude;
  const right = docStyle.marginRight?.magnitude;
  const w = docStyle.pageSize?.width?.magnitude;
  const h = docStyle.pageSize?.height?.magnitude;
  const mode = docStyle.documentFormat?.documentMode;
  const hasMargins = top != null || bottom != null || left != null || right != null;
  const hasMode = mode != null;
  const hasSize = w != null || h != null;
  if (!hasMargins && !hasMode && !hasSize)
    return;
  const pageSetup = {};
  if (hasMargins) {
    pageSetup.margins = {
      ...bottom != null ? { bottom } : {},
      ...left != null ? { left } : {},
      ...right != null ? { right } : {},
      ...top != null ? { top } : {}
    };
  }
  if (hasMode) {
    pageSetup.mode = mode;
  }
  if (hasSize) {
    if (w != null && h != null) {
      pageSetup.orientation = w > h ? "LANDSCAPE" : "PORTRAIT";
    }
    pageSetup.pageHeight = h;
    if (w != null && h != null) {
      if (w === 612 && h === 792 || w === 792 && h === 612) {
        pageSetup.pageSize = "LETTER";
      } else if (w === 612 && h === 1008 || w === 1008 && h === 612) {
        pageSetup.pageSize = "LEGAL";
      } else if (w === 792 && h === 1224 || w === 1224 && h === 792) {
        pageSetup.pageSize = "TABLOID";
      } else if (w === 595.28 && h === 841.89 || w === 841.89 && h === 595.28) {
        pageSetup.pageSize = "A4";
      } else {
        pageSetup.pageSize = "CUSTOM";
      }
    }
    pageSetup.pageWidth = w;
  }
  if (hasMode) {
    pageSetup.pageless = mode === "PAGELESS";
  }
  return pageSetup;
}
var TABLE_INSERT_MIX_MSG = "Table insert cannot share an apply with remove or edits to other nodes. Insert the table (optional style on that new table), query, then fill or remove.";
var WRITE_AT_ONLY_MSG = 'Write ops require "at" from query nodes[].id or cells[].id (e.g. "h.arch.9a1b").';
var CELL_FIELD_MSG = 'Copy the cell id from query --full (e.g. "h.arch.table.0.1.3c8f"), not cell/para/segmentId/tabId fields.';
function resolveMarkdownContent(val, filePath, opName, index) {
  if (val === undefined && filePath === undefined)
    return;
  if (filePath) {
    try {
      return readFileSync6(filePath, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`ops[${index}] failed to read file "${filePath}": ${msg}`);
    }
  }
  if (val === true) {
    throw new Error(`ops[${index}] ${opName}: true requires a "file" property specifying the path to read`);
  }
  if (typeof val === "string") {
    if (!val.includes(`
`) && (val.endsWith(".md") || val.endsWith(".markdown") || existsSync11(val))) {
      try {
        if (existsSync11(val) && statSync2(val).isFile()) {
          return readFileSync6(val, "utf8");
        }
      } catch {}
    }
    return val;
  }
  return;
}
function tapeMutationsApply(writer, ops, baseIndex = 0, opts = {}) {
  const plan = [];
  const afterendTails = opts.afterendTails ?? new Map;
  const rootAnchors = opts.rootAnchors ?? new Map;
  const namedAnchors = opts.namedAnchors ?? new Map;
  const deletedNodes = [...opts.clearedNodes ?? []];
  const wipedScopeNodes = [...opts.clearedNodes ?? []];
  const insertedNodes = [];
  for (let i = 0;i < ops.length; i++) {
    const rawInputOp = ops[i];
    const op = { ...rawInputOp };
    const effectiveForce = Boolean(op.force || opts.force || writer.force);
    const index = baseIndex + i;
    writer.setNextOpIndex(index);
    const live = new DocDom(writer.nodes);
    if (Object.hasOwn(op, "cell") || Object.hasOwn(op, "para") || Object.hasOwn(op, "segmentId") || Object.hasOwn(op, "tabId")) {
      throw new Error(`ops[${index}] ${CELL_FIELD_MSG}`);
    }
    const anchorCount = Number(op.at != null) + Number(op.after != null) + Number(op.before != null);
    if (anchorCount > 1) {
      throw new Error(`ops[${index}] specify only one of "at", "after", or "before"`);
    }
    if (anchorCount === 0) {
      throw new Error(`ops[${index}] requires an anchor ("at", "after", or "before")`);
    }
    const rawAnchor = op.at ?? op.after ?? op.before;
    op.at = rawAnchor;
    const inferredPosition = op.after != null ? "afterend" : op.before != null ? "beforebegin" : op.position ?? "afterend";
    if (op.replace !== undefined) {
      if (op.innerText !== undefined) {
        throw new Error(`ops[${index}] specify either "replace" or "innerText", not both`);
      }
      op.innerText = op.replace;
    }
    if (op.insertMarkdown !== undefined || op.file && !op.replaceMarkdown && !op.replaceSection) {
      op.insertMarkdown = resolveMarkdownContent(op.insertMarkdown, op.file, "insertMarkdown", index);
    }
    if (op.replaceMarkdown !== undefined) {
      op.replaceMarkdown = resolveMarkdownContent(op.replaceMarkdown, op.file, "replaceMarkdown", index);
    }
    if (op.replaceSection !== undefined) {
      op.replaceSection = resolveMarkdownContent(op.replaceSection, op.file, "replaceSection", index);
    }
    const markdownOpts = markdownParseOptionsFromOp(op, writer);
    if (op.insertMarkdown !== undefined) {
      if (typeof op.insertMarkdown !== "string") {
        throw new Error(`ops[${index}] insertMarkdown must be a string or file path`);
      }
      if (op.insertAdjacentElement != null) {
        throw new Error(`ops[${index}] specify either "insertMarkdown" or "insertAdjacentElement", not both`);
      }
      const specs = parseMarkdownToElements(op.insertMarkdown, markdownOpts);
      op.insertAdjacentElement = {
        elements: specs,
        position: op.position ?? inferredPosition
      };
    }
    if (op.insertSectionBreak !== undefined) {
      if (op.insertAdjacentElement != null || op.element != null || op.elements != null) {
        throw new Error(`ops[${index}] specify either "insertSectionBreak" or "insertAdjacentElement", not both`);
      }
      const sectionType = typeof op.insertSectionBreak === "object" ? op.insertSectionBreak.sectionType : "NEXT_PAGE";
      op.insertAdjacentElement = {
        element: { kind: "sectionBreak", sectionType },
        position: op.position ?? inferredPosition
      };
    }
    if (op.insertPerson !== undefined) {
      if (op.insertAdjacentElement != null || op.element != null || op.elements != null) {
        throw new Error(`ops[${index}] specify either "insertPerson" or "insertAdjacentElement", not both`);
      }
      op.insertAdjacentElement = {
        element: { email: op.insertPerson.email, kind: "person" },
        position: op.position ?? inferredPosition
      };
    }
    if (op.insertRichLink !== undefined) {
      if (op.insertAdjacentElement != null || op.element != null || op.elements != null) {
        throw new Error(`ops[${index}] specify either "insertRichLink" or "insertAdjacentElement", not both`);
      }
      op.insertAdjacentElement = {
        element: { kind: "richLink", ...op.insertRichLink },
        position: op.position ?? inferredPosition
      };
    }
    if (op.insertDate !== undefined) {
      if (op.insertAdjacentElement != null || op.element != null || op.elements != null) {
        throw new Error(`ops[${index}] specify either "insertDate" or "insertAdjacentElement", not both`);
      }
      op.insertAdjacentElement = {
        element: { kind: "date", ...op.insertDate },
        position: op.position ?? inferredPosition
      };
    }
    if (op.insertFootnote !== undefined) {
      if (op.insertAdjacentElement != null || op.element != null || op.elements != null) {
        throw new Error(`ops[${index}] specify either "insertFootnote" or "insertAdjacentElement", not both`);
      }
      op.insertAdjacentElement = {
        element: { kind: "footnote", ...op.insertFootnote },
        position: op.position ?? inferredPosition
      };
    }
    if (op.insertImage !== undefined) {
      if (op.insertAdjacentElement != null || op.element != null || op.elements != null) {
        throw new Error(`ops[${index}] specify either "insertImage" or "insertAdjacentElement", not both`);
      }
      op.insertAdjacentElement = {
        element: { kind: "inlineImage", ...op.insertImage },
        position: op.position ?? inferredPosition
      };
    }
    if (op.element != null || op.elements != null || op.cloneNode != null || op.cloneNodes != null) {
      if (op.insertAdjacentElement != null) {
        throw new Error(`ops[${index}] specify either top-level element/elements/cloneNode or insertAdjacentElement, not both`);
      }
      op.insertAdjacentElement = {
        cloneNode: op.cloneNode,
        cloneNodes: op.cloneNodes,
        element: op.element,
        elements: op.elements,
        position: op.position ?? inferredPosition
      };
    }
    if (op.insertAdjacentElement && !op.insertAdjacentElement.position) {
      op.insertAdjacentElement = {
        ...op.insertAdjacentElement,
        position: inferredPosition
      };
    }
    if (op.tableStyle) {
      op.style = { ...op.style ?? {}, ...op.tableStyle };
    }
    const dest = writeAtParse(op.at, namedAnchors);
    const target = targetResolve(live, op, namedAnchors);
    const cell = dest.cell;
    const para = dest.para;
    const patch = styleFromOp(op, index);
    const isTableGridOp = op.insertTableRow != null || op.deleteTableRow != null || op.insertTableColumn != null || op.deleteTableColumn != null || op.duplicateTableRow != null;
    const exclusive = Number(op.insertAdjacentElement != null) + Number(Boolean(op.remove)) + Number(Boolean(op.dangerousRemoveSection)) + Number(op.replaceMarkdown !== undefined) + Number(op.replaceSection !== undefined) + Number(isTableGridOp);
    const content = Number(op.innerText !== undefined) + Number(op.namedStyleType !== undefined);
    const listAction = Number(op.bullet != null);
    if (exclusive && (exclusive !== 1 || content || patch || listAction)) {
      throw new Error(`ops[${index}] table grid ops, replaceSection, replaceMarkdown, insertAdjacentElement, remove, and dangerousRemoveSection cannot combine with other actions`);
    }
    if (op.tableAlignment !== undefined) {
      throw new Error(`ops[${index}] tableAlignment is not supported: Google Docs tables default to full page width (left-aligned under the hood). Google Docs REST API has no property or request for table page alignment (center/left/right). Use fixed columnWidth to control column sizes (table remains left-aligned), or cellTextAlignment to align cell text.`);
    }
    if (!exclusive && !content && !patch && !listAction) {
      throw new Error(`ops[${index}] needs replaceSection, replaceMarkdown, insertMarkdown, innerText, replace, element/elements, insertAdjacentElement, namedStyleType, style/alignment, bullet, remove, dangerousRemoveSection, or table grid operation`);
    }
    if (cell && !isTableGridOp && (op.insertAdjacentElement != null || op.remove || op.dangerousRemoveSection || op.replaceMarkdown !== undefined || op.replaceSection !== undefined || op.namedStyleType !== undefined || op.bullet)) {
      throw new Error(`ops[${index}] cell ids are only valid with innerText, replace, alignment, style, or table row/column operations`);
    }
    const snapshot = summarizeNode(target);
    const handle = writer.wrap(target);
    const loc2 = {
      ...cell ? { cell } : {},
      ...para != null ? { para } : {}
    };
    const warnings = [];
    if (patch)
      warnings.push(...indentWarnings(target, patch, writer.nodes));
    if (op.bullet) {
      applyBulletRestyle(writer, target, op.bullet, index);
      const others = listSiblingCount(writer.nodes, target);
      const presetName = typeof op.bullet === "object" ? op.bullet.preset : "";
      warnings.push(`createParagraphBullets converts ${others + 1} item(s) sharing this listId to ${presetName}. Custom glyph text and start-at-N are not in the Docs API.`);
    }
    if (op.dangerousRemoveSection) {
      if (!isHeadingStyle(target.namedStyleType)) {
        throw new Error(`ops[${index}] dangerousRemoveSection requires a heading node target`);
      }
      const sectionNodes = neighborhoodFrom(writer.nodes, target.tapeIndex);
      const unrecWarnings = [];
      for (const sNode of sectionNodes) {
        assertNotFragile(sNode, "remove", effectiveForce);
        const w = formatUnrecoverableWarning(sNode);
        if (w)
          unrecWarnings.push(w);
      }
      deletedNodes.push(...sectionNodes);
      wipedScopeNodes.push(...sectionNodes);
      plan.push(withWarnings({
        action: "dangerousRemoveSection",
        index,
        target: snapshot,
        ...loc2
      }, [
        ...chipWarnings(target, cell, para),
        `Removing heading and all ${sectionNodes.length - 1} following section nodes.`,
        ...unrecWarnings
      ]));
      for (let s = sectionNodes.length - 1;s >= 0; s--) {
        const sNode = sectionNodes[s];
        removeNodeSafely(writer, sNode);
      }
      continue;
    }
    if (isTableGridOp) {
      if (target.kind !== "table") {
        throw new Error(`ops[${index}] table row/column operations require a table target`);
      }
      const r = cell ? cell[0] : (typeof op.insertTableRow === "object" ? op.insertTableRow.row : typeof op.deleteTableRow === "object" ? op.deleteTableRow.row : typeof op.duplicateTableRow === "object" ? op.duplicateTableRow.row : 0) ?? 0;
      const c = cell ? cell[1] : (typeof op.insertTableColumn === "object" ? op.insertTableColumn.col : typeof op.deleteTableColumn === "object" ? op.deleteTableColumn.col : 0) ?? 0;
      if (op.insertTableRow != null) {
        const insertBelow = typeof op.insertTableRow === "object" && op.insertTableRow.insertBelow !== undefined ? op.insertTableRow.insertBelow : true;
        plan.push(withWarnings({
          action: "insertTableRow",
          index,
          target: snapshot,
          ...loc2
        }, warnings));
        const cells = typeof op.insertTableRow === "object" && Array.isArray(op.insertTableRow.cells) ? op.insertTableRow.cells : undefined;
        writer.insertTableRow(target, [r, c], insertBelow, cells);
        if (op.as)
          namedAnchors.set(op.as.trim(), target);
        continue;
      }
      if (op.deleteTableRow != null) {
        plan.push(withWarnings({
          action: "deleteTableRow",
          index,
          target: snapshot,
          ...loc2
        }, warnings));
        writer.deleteTableRow(target, [r, c]);
        if (op.as)
          namedAnchors.set(op.as.trim(), target);
        continue;
      }
      if (op.insertTableColumn != null) {
        const insertRight = typeof op.insertTableColumn === "object" && op.insertTableColumn.insertRight !== undefined ? op.insertTableColumn.insertRight : true;
        plan.push(withWarnings({
          action: "insertTableColumn",
          index,
          target: snapshot,
          ...loc2
        }, warnings));
        writer.insertTableColumn(target, [r, c], insertRight);
        if (op.as)
          namedAnchors.set(op.as.trim(), target);
        continue;
      }
      if (op.deleteTableColumn != null) {
        plan.push(withWarnings({
          action: "deleteTableColumn",
          index,
          target: snapshot,
          ...loc2
        }, warnings));
        writer.deleteTableColumn(target, [r, c]);
        if (op.as)
          namedAnchors.set(op.as.trim(), target);
        continue;
      }
      if (op.duplicateTableRow != null) {
        const insertBelow = typeof op.duplicateTableRow === "object" && op.duplicateTableRow.insertBelow !== undefined ? op.duplicateTableRow.insertBelow : true;
        plan.push(withWarnings({
          action: "duplicateTableRow",
          index,
          target: snapshot,
          ...loc2
        }, warnings));
        const sourceCells = target.table?.cells?.[r];
        const cells = sourceCells ? sourceCells.map((sc) => sc.text ?? "") : undefined;
        writer.insertTableRow(target, [r, c], insertBelow, cells);
        if (op.as)
          namedAnchors.set(op.as.trim(), target);
        continue;
      }
    }
    if (op.remove) {
      assertNotFragile(target, "remove", effectiveForce);
      deletedNodes.push(target);
      const remainingParas = writer.nodes.filter((n) => n.kind === "paragraph");
      const isLastRemainingPara = target.kind === "paragraph" && (remainingParas.length <= 1 || writer.nodes[writer.nodes.length - 1]?.tapeIndex === target.tapeIndex);
      if (isLastRemainingPara) {
        if (target.bullet) {
          delete target.bullet;
        }
        handle.innerText = "";
        handle.namedStyleType = "NORMAL_TEXT";
        plan.push(withWarnings({
          action: "innerText",
          index,
          innerText: "",
          namedStyleType: "NORMAL_TEXT",
          target: snapshot,
          ...loc2
        }, [
          ...chipWarnings(target, cell, para),
          "Target is the last paragraph of the document tape; converted remove to clear innerText and reset namedStyleType to NORMAL_TEXT (Docs rejects deleting the trailing newline)."
        ]));
        continue;
      }
      const removeUnrec = formatUnrecoverableWarning(target);
      plan.push(withWarnings({ action: "remove", index, target: snapshot, ...loc2 }, [
        ...chipWarnings(target, cell, para),
        ...removeUnrec ? [removeUnrec] : []
      ]));
      handle.remove();
      continue;
    }
    if (op.replaceSection !== undefined) {
      if (typeof op.replaceSection !== "string") {
        throw new Error(`ops[${index}] replaceSection must be a string or file path`);
      }
      if (!isHeadingStyle(target.namedStyleType)) {
        throw new Error(`ops[${index}] replaceSection requires a heading node target (found "${target.namedStyleType ?? target.kind}"). To replace a single node, use replaceMarkdown or replace.`);
      }
      const scopeNodes = neighborhoodFrom(writer.nodes, target.tapeIndex);
      if (markdownOpts.h1IsTitle === undefined && target.namedStyleType === "TITLE") {
        markdownOpts.h1IsTitle = true;
      }
      const incomingSpecs = parseMarkdownToElements(op.replaceSection, markdownOpts);
      const isTopLevelHeading = target.namedStyleType === "TITLE" || target.namedStyleType === "HEADING_1";
      if (isTopLevelHeading) {
        const targetLevel2 = STYLE_TO_LEVEL[target.namedStyleType] ?? 1;
        const childHeadings = scopeNodes.filter((n) => n.tapeIndex !== target.tapeIndex && isHeadingStyle(n.namedStyleType));
        const incomingChildHeadings = incomingSpecs.filter((s) => s.kind === "paragraph" && isHeadingStyle(s.namedStyleType) && (STYLE_TO_LEVEL[s.namedStyleType] ?? 99) > targetLevel2);
        if (childHeadings.length > 0 && incomingChildHeadings.length === 0 && !effectiveForce) {
          const previewList = childHeadings.slice(0, 5).map((h) => `"${preview(h.text ?? "")}"`).join(", ");
          throw new Error(`ops[${index}] replaceSection on ${target.namedStyleType} "${preview(target.text ?? "")}" would delete ${childHeadings.length} child heading(s) (${previewList}). To replace only the title/heading paragraph, use replace or replaceMarkdown. To replace the entire section including all subsections, include them in your markdown or pass force: true.`);
        }
      }
      const targetLevel = STYLE_TO_LEVEL[target.namedStyleType] ?? 1;
      const incomingStartsWithHeading = incomingSpecs.length > 0 && incomingSpecs[0]?.kind === "paragraph" && isHeadingStyle(incomingSpecs[0].namedStyleType);
      const incomingLevel = incomingStartsWithHeading ? STYLE_TO_LEVEL[incomingSpecs[0].namedStyleType] ?? 99 : 99;
      const incomingReplacesAnchor = incomingStartsWithHeading && incomingLevel <= targetLevel;
      const diffNodes = incomingReplacesAnchor ? scopeNodes : scopeNodes.slice(1);
      plan.push(withWarnings({
        action: "replaceSection",
        index,
        target: snapshot,
        ...loc2
      }, [
        ...chipWarnings(target, cell, para),
        `Diff-replacing section (${diffNodes.length} live node(s) vs ${incomingSpecs.length} markdown element(s)).`
      ], op.as));
      diffAndApplyMarkdown(writer, diffNodes, incomingSpecs, target, effectiveForce);
      if (op.as)
        namedAnchors.set(op.as.trim(), target);
      continue;
    }
    if (op.replaceMarkdown !== undefined) {
      if (typeof op.replaceMarkdown !== "string") {
        throw new Error(`ops[${index}] replaceMarkdown must be a string or file path`);
      }
      assertNotFragile(target, "replace", effectiveForce);
      const scopeNodes = [target];
      if (markdownOpts.h1IsTitle === undefined && target.namedStyleType === "TITLE") {
        markdownOpts.h1IsTitle = true;
      }
      const incomingSpecs = parseMarkdownToElements(op.replaceMarkdown, markdownOpts);
      plan.push(withWarnings({
        action: "replaceMarkdown",
        index,
        target: snapshot,
        ...loc2
      }, [
        ...chipWarnings(target, cell, para),
        `Diff-replacing single node (${target.namedStyleType ?? target.kind}) with ${incomingSpecs.length} markdown element(s).`
      ], op.as));
      diffAndApplyMarkdown(writer, scopeNodes, incomingSpecs, target, effectiveForce);
      if (op.as)
        namedAnchors.set(op.as.trim(), target);
      continue;
    }
    if (op.insertAdjacentElement) {
      const adj = op.insertAdjacentElement;
      if (!adj.elements?.length && !adj.element && (adj.cloneNode != null || Array.isArray(adj.cloneNodes) && adj.cloneNodes.length > 0)) {
        const refs = [];
        if (adj.cloneNode != null) {
          refs.push(typeof adj.cloneNode === "object" ? adj.cloneNode : { nodeId: adj.cloneNode });
        }
        if (Array.isArray(adj.cloneNodes)) {
          for (const item of adj.cloneNodes) {
            refs.push(typeof item === "object" ? item : { nodeId: item });
          }
        }
        const specs = [];
        for (const ref of refs) {
          if (ref.fromDoc) {
            throw new Error(`ops[${index}] cloneNode with fromDoc ("${ref.fromDoc}") requires resolveCloneNodeOps or running via apply`);
          }
          const spec = resolveIntraDocCloneNode(ref, writer.nodes);
          specs.push(spec);
        }
        adj.elements = specs;
      }
      const initialElements = Array.isArray(adj.elements) ? adj.elements : adj.element ? [adj.element] : [];
      if (!initialElements.length) {
        throw new Error(`ops[${index}] insertAdjacentElement requires "element", "elements", or "cloneNode"`);
      }
      const rawElements = [];
      for (const el of initialElements) {
        if (el && el.kind === "codeBlock" && typeof el.text === "string" && stripTrailingNewline(el.text).includes(`
`)) {
          const specs = createCodeBlock({
            alignment: typeof el.alignment === "string" ? asAlignment(el.alignment) : undefined,
            language: typeof el.language === "string" ? el.language : undefined,
            style: el.style && typeof el.style === "object" ? el.style : undefined,
            text: el.text
          }, { force: writer.force });
          for (const s of specs) {
            rawElements.push(s);
          }
        } else {
          rawElements.push(el);
        }
      }
      insertedNodes.push(...rawElements);
      let currentHandle = handle;
      let currentAnchor = target;
      let firstInsertedNode;
      if (adj.position === "afterend") {
        const root = rootAnchors.get(target.tapeIndex) ?? target.tapeIndex;
        const tail = afterendTails.get(root) ?? afterendTails.get(target.tapeIndex);
        const liveTail = tail ? writer.nodes.find((n) => n.tapeIndex === tail.tapeIndex) : undefined;
        if (liveTail) {
          currentAnchor = liveTail;
          currentHandle = writer.wrap(liveTail);
        }
      }
      for (let elIdx = 0;elIdx < rawElements.length; elIdx++) {
        const rawEl = rawElements[elIdx];
        const effectivePosition = adj.position === "beforebegin" && elIdx > 0 ? "afterend" : adj.position ?? "afterend";
        if (effectivePosition === "afterend" && currentAnchor.bullet && rawEl && (rawEl.bullet === true || rawEl.bullet && typeof rawEl.bullet === "object" && rawEl.bullet.nestingLevel == null)) {
          const rawBullet = rawEl.bullet === true ? {} : rawEl.bullet;
          rawEl.bullet = {
            ...rawBullet,
            nestingLevel: currentAnchor.bullet.nestingLevel
          };
        }
        const spec = elementFromJson(rawEl, writer.force);
        const insertWarnings = [];
        if ("warnings" in spec && Array.isArray(spec.warnings)) {
          insertWarnings.push(...spec.warnings);
        }
        const neighbor = effectivePosition === "afterend" ? live.nextElementSibling(currentAnchor) : effectivePosition === "beforebegin" ? live.previousElementSibling(currentAnchor) : null;
        if (spec.kind === "table" && effectivePosition === "afterend" && isHeadingStyle(currentAnchor.namedStyleType)) {
          insertWarnings.push("insertTable afterend of a heading splits an empty HEADING_* that Docs will not delete. Insert afterend of a NORMAL_TEXT sibling.");
        }
        if (spec.kind === "paragraph" && neighbor?.kind === "paragraph" && samePlainText(neighbor.text, spec.text)) {
          insertWarnings.push("The paragraph next to this insert already says the same thing. Query that heading's neighbors before inserting, or you will duplicate it.");
        }
        if (effectivePosition === "afterend" && currentAnchor.bullet && spec.kind === "paragraph" && !spec.bullet) {
          insertWarnings.push('Inserting paragraph after list item without "bullet" — stripped inherited list glyph. Pass "bullet": true (or "bullet": {}) to continue the list.');
        }
        if (spec.kind === "paragraph") {
          insertWarnings.push(...indentFootguns({
            indentFirstLine: spec.style?.indentFirstLine,
            indentStart: spec.indentStart?.magnitude ?? spec.style?.indentStart,
            isBullet: Boolean(spec.bullet),
            siblingCount: 0
          }));
        }
        plan.push(withWarnings({
          action: "insertAdjacentElement",
          index,
          insertAdjacentElement: summarizeInsert(effectivePosition, spec),
          target: summarizeNode(currentAnchor),
          ...loc2
        }, insertWarnings));
        currentHandle = currentHandle.insertAdjacentElement(effectivePosition, spec);
        currentAnchor = currentHandle.node;
        if (!firstInsertedNode)
          firstInsertedNode = currentAnchor;
        if (adj.position === "afterend") {
          const root = rootAnchors.get(target.tapeIndex) ?? target.tapeIndex;
          rootAnchors.set(currentAnchor.tapeIndex, root);
          afterendTails.set(root, currentAnchor);
          afterendTails.set(target.tapeIndex, currentAnchor);
        }
      }
      if (op.as) {
        const asName = op.as.trim();
        const headNode = firstInsertedNode ?? currentAnchor;
        namedAnchors.set(asName, headNode);
        if (headNode && currentAnchor && headNode.tapeIndex !== currentAnchor.tapeIndex) {
          afterendTails.set(headNode.tapeIndex, currentAnchor);
        }
      }
      continue;
    }
    if (op.innerText !== undefined) {
      const targetPara = cell && target.table ? target.table.cells[cell[0]]?.[cell[1]]?.paragraphs?.[para ?? 0] ?? target.table.cells[cell[0]]?.[cell[1]] ?? target : target;
      assertNotFragile(targetPara, "innerText", effectiveForce);
      plan.push(withWarnings({
        action: "innerText",
        index,
        innerText: op.innerText,
        ...op.namedStyleType !== undefined ? { namedStyleType: op.namedStyleType } : {},
        ...op.bullet ? { bullet: op.bullet } : {},
        ...patch ? { style: patch } : {},
        target: snapshot,
        ...loc2
      }, [...chipWarnings(target, cell, para), ...warnings]));
      writer.setInnerText(target, op.innerText, cell, para, {
        runs: op.runs
      });
      if (op.namedStyleType !== undefined) {
        handle.namedStyleType = op.namedStyleType;
      }
      if (patch)
        writer.setStyle(target, patch, cell, para);
      if (op.as)
        namedAnchors.set(op.as.trim(), target);
      continue;
    }
    if (op.namedStyleType !== undefined) {
      plan.push(withWarnings({
        action: "namedStyleType",
        index,
        namedStyleType: op.namedStyleType,
        ...op.bullet ? { bullet: op.bullet } : {},
        ...patch ? { style: patch } : {},
        target: snapshot,
        ...loc2
      }, warnings));
      handle.namedStyleType = op.namedStyleType;
      if (patch)
        writer.setStyle(target, patch, cell, para);
      if (op.as)
        namedAnchors.set(op.as.trim(), target);
      continue;
    }
    if (!patch) {
      plan.push(withWarnings({
        action: "bullets",
        bullet: op.bullet,
        index,
        target: snapshot,
        ...loc2
      }, warnings));
      if (op.as)
        namedAnchors.set(op.as.trim(), target);
      continue;
    }
    const action = Object.keys(patch).length === 1 && patch.alignment && !op.bullet ? "alignment" : "style";
    if (target.kind === "table" && !cell && (patch.alignment || patch.cellTextAlignment)) {
      warnings.push("Google Docs REST API lacks page-level table alignment. Setting alignment on a table formats the text inside cells (cellTextAlignment). Tables with fixed columnWidth remain left-aligned on the page.");
    }
    plan.push(withWarnings({
      action,
      ...patch.alignment ? { alignment: patch.alignment } : {},
      ...op.bullet ? { bullet: op.bullet } : {},
      index,
      ...action === "style" ? { style: patch } : {},
      target: snapshot,
      ...loc2
    }, warnings));
    writer.setStyle(target, patch, cell, para);
    if (op.as)
      namedAnchors.set(op.as.trim(), target);
  }
  if (!opts.force && !writer.force && deletedNodes.length > 0 && insertedNodes.length > 0) {
    const isSingleNodeMove = wipedScopeNodes.length === 0 && deletedNodes.length === 1 && insertedNodes.length === 1;
    if (!isSingleNodeMove) {
      const unchangedMatches = [];
      for (const del of deletedNodes) {
        const normText = (del.text ?? "").trim();
        const wasWipedScope = wipedScopeNodes.some((w) => w.tapeIndex === del.tapeIndex);
        if (!normText || !wasWipedScope && normText.length < 40)
          continue;
        const delCsum = computeNodeChecksum(del);
        for (const ins of insertedNodes) {
          const insText = (typeof ins.text === "string" ? ins.text : "").trim();
          if (!insText || !wasWipedScope && insText.length < 40)
            continue;
          if (computeNodeChecksum(ins) === delCsum) {
            unchangedMatches.push({ deleted: del, inserted: ins });
            break;
          }
        }
      }
      const hasWipedScopeMatch = unchangedMatches.some((m2) => wipedScopeNodes.some((w) => w.tapeIndex === m2.deleted.tapeIndex));
      if (hasWipedScopeMatch || unchangedMatches.length >= 2) {
        const details = unchangedMatches.slice(0, 10).map((m2) => `  - ${m2.deleted.namedStyleType ?? m2.deleted.kind}: "${preview(m2.deleted.text ?? "")}" (id: ${m2.deleted.scopedId ?? m2.deleted.tapeIndex})`).join(`
`);
        throw new Error(`Lazy replacement rejected: ${unchangedMatches.length} unchanged node(s) were deleted and re-created with identical content:
${details}
` + `Deleting existing nodes destroys comment threads, suggestion mode history, and revision blame.
` + `Keep unchanged nodes intact:
` + `  • Use "replaceSection" to automatically diff a section and preserve unchanged nodes
` + `  • Use "replaceMarkdown" to surgically replace a single node
` + `  • Or target changed nodes surgically with "innerText" / "replace"
` + `  • Only use "remove" for nodes that are genuinely deleted
` + `  • To override and force wholesale replacement, pass force: true on the op or apply document`);
      }
    }
  }
  return plan;
}
function removeNodeSafely(writer, node) {
  const remainingParas = writer.nodes.filter((n) => n.kind === "paragraph");
  const handle = writer.wrap(node);
  if (node.kind === "paragraph" && remainingParas.length <= 1) {
    if (node.bullet)
      delete node.bullet;
    handle.innerText = "";
    handle.namedStyleType = "NORMAL_TEXT";
  } else {
    handle.remove();
  }
}
function diffAndApplyMarkdown(writer, oldNodes, newSpecs, anchorTarget, force) {
  const oldChecksums = oldNodes.map((n) => computeNodeChecksum(n));
  const newChecksums = newSpecs.map((s) => computeNodeChecksum(s));
  const N2 = oldNodes.length;
  const M2 = newSpecs.length;
  const dp = Array.from({ length: N2 + 1 }, () => Array(M2 + 1).fill(0));
  for (let i = 0;i < N2; i++) {
    for (let j = 0;j < M2; j++) {
      if (oldChecksums[i] === newChecksums[j]) {
        dp[i + 1][j + 1] = dp[i]?.[j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1]?.[j], dp[i]?.[j + 1]);
      }
    }
  }
  const matches = [];
  let ci = N2;
  let cj = M2;
  while (ci > 0 && cj > 0) {
    if (oldChecksums[ci - 1] === newChecksums[cj - 1]) {
      matches.unshift({ oldIdx: ci - 1, newIdx: cj - 1 });
      ci--;
      cj--;
    } else if (dp[ci - 1]?.[cj] >= dp[ci]?.[cj - 1]) {
      ci--;
    } else {
      cj--;
    }
  }
  const boundaries = [{ oldIdx: -1, newIdx: -1 }, ...matches, { oldIdx: N2, newIdx: M2 }];
  let lastAnchorNode;
  for (let b2 = 0;b2 < boundaries.length - 1; b2++) {
    const prevMatch = boundaries[b2];
    const nextMatch = boundaries[b2 + 1];
    if (prevMatch.oldIdx >= 0) {
      lastAnchorNode = oldNodes[prevMatch.oldIdx];
    }
    const fromOld = prevMatch.oldIdx + 1;
    const toOld = nextMatch.oldIdx;
    const fromNew = prevMatch.newIdx + 1;
    const toNew = nextMatch.newIdx;
    const oldSlice = oldNodes.slice(fromOld, toOld);
    const newSlice = newSpecs.slice(fromNew, toNew);
    const p = oldSlice.length;
    const q = newSlice.length;
    const shared = Math.min(p, q);
    for (let k = 0;k < shared; k++) {
      const oldNode = oldSlice[k];
      const newSpec = newSlice[k];
      assertNotFragile(oldNode, "replace", force);
      const paraSpec = newSpec.kind === "paragraph" ? newSpec : undefined;
      const oldHasBullet = Boolean(oldNode.bullet);
      const newHasBullet = Boolean(paraSpec?.bullet);
      const oldNesting = oldNode.bullet?.nestingLevel ?? 0;
      const newNesting = paraSpec?.bullet?.nestingLevel ?? 0;
      const oldPreset = oldNode.bullet?.preset;
      const newPreset = paraSpec?.bullet?.preset;
      const bulletChanged = oldHasBullet !== newHasBullet || oldHasBullet && (oldNesting !== newNesting || oldPreset && newPreset && oldPreset !== newPreset);
      if (oldNode.kind === "paragraph" && newSpec.kind === "paragraph" && !bulletChanged) {
        const handle = writer.wrap(oldNode);
        if (paraSpec?.runs?.length) {
          writer.setInnerText(oldNode, paraSpec.text, undefined, undefined, { runs: paraSpec.runs });
        } else {
          handle.innerText = paraSpec.text;
        }
        handle.namedStyleType = paraSpec.namedStyleType;
        if (paraSpec.alignment)
          handle.alignment = paraSpec.alignment;
        if (paraSpec.style)
          writer.setStyle(oldNode, paraSpec.style);
        lastAnchorNode = oldNode;
      } else {
        const insertAnchor = lastAnchorNode ?? anchorTarget;
        const inserted = writer.insertAdjacentElement(insertAnchor, "afterend", newSpec);
        lastAnchorNode = inserted;
        removeNodeSafely(writer, oldNode);
      }
    }
    if (p < q) {
      for (let k = shared;k < q; k++) {
        const newSpec = newSlice[k];
        const insertAnchor = lastAnchorNode ?? anchorTarget;
        const inserted = writer.insertAdjacentElement(insertAnchor, "afterend", newSpec);
        lastAnchorNode = inserted;
      }
    } else if (p > q) {
      for (let k = shared;k < p; k++) {
        const oldNode = oldSlice[k];
        assertNotFragile(oldNode, "remove", force);
        removeNodeSafely(writer, oldNode);
      }
    }
    if (nextMatch.oldIdx >= 0 && nextMatch.oldIdx < N2) {
      lastAnchorNode = oldNodes[nextMatch.oldIdx];
    }
  }
}
function withWarnings(entry, warnings, as) {
  if (warnings.length)
    entry.warnings = warnings;
  if (as)
    entry.as = as;
  return entry;
}
function applyBulletRestyle(writer, target, bullet, index) {
  if (isHeadingStyle(target.namedStyleType)) {
    throw new Error(HEADING_BULLET_MSG);
  }
  if (typeof bullet === "boolean") {
    if (!bullet) {
      throw new Error(`ops[${index}] bullet: false is not supported; use remove or style`);
    }
    throw new Error(`ops[${index}] bullet restyle requires preset (a Docs BulletGlyphPreset)`);
  }
  if (bullet.nestingLevel != null) {
    const current = target.bullet?.nestingLevel ?? 0;
    if (target.bullet ? bullet.nestingLevel !== current : bullet.nestingLevel > 0) {
      throw new Error(EXISTING_NEST_MSG);
    }
  }
  if (!bullet.preset) {
    throw new Error(`ops[${index}] bullet restyle requires preset (a Docs BulletGlyphPreset)`);
  }
  const preset = asBulletPreset(bullet.preset);
  if (!preset) {
    throw new Error(`Unknown bullet preset "${bullet.preset}". Use a Docs BulletGlyphPreset (NUMBERED_* / BULLET_*).`);
  }
  writer.setBulletPreset(target, preset);
}
function listSiblingCount(nodes, target) {
  const listId = target.bullet?.listId;
  if (!listId)
    return 0;
  return nodes.filter((n) => n.tapeIndex !== target.tapeIndex && n.bullet?.listId === listId).length;
}
function indentFootguns(opts) {
  const out = [];
  if (opts.isBullet && opts.indentStart != null && opts.indentFirstLine == null) {
    const first = hangingFirstLine(opts.indentStart);
    out.push(`List indentStart ${opts.indentStart} sets hanging indentFirstLine ${first} (glyph vs text). Flush level-0 is indentStart: 18, indentFirstLine: 0. Pass both to skip the default. indentStart: 0 stacks the glyph on the text.`);
  }
  if (opts.isBullet && opts.siblingCount > 0 && (opts.indentStart != null || opts.indentFirstLine != null)) {
    out.push(`This listId is shared by ${opts.siblingCount} other item(s). Paragraph indent may not move siblings — style each item, or use the Docs ruler for the list.`);
  }
  return out;
}
function indentWarnings(target, patch, nodes) {
  if (!hasIndent(patch))
    return [];
  return indentFootguns({
    indentFirstLine: patch.indentFirstLine,
    indentStart: patch.indentStart,
    isBullet: Boolean(target.bullet),
    siblingCount: listSiblingCount(nodes, target)
  });
}
var applyOps = tapeMutationsApply;
function notFragileAssert(node, action, force) {
  if (force)
    return;
  const id = "kind" in node ? node.scopedId ?? node.tapeIndex : "cell";
  if (node.hasEquation) {
    throw new Error(`Refusing to ${action} node ${id} (contains a math equation):
` + `Google Docs REST API cannot recreate math equations; modifying or deleting this node will permanently destroy it.
` + `To proceed intentionally, pass force: true in the op or on the apply document.`);
  }
  if (node.chips?.length) {
    const titles = node.chips.map((c) => `"${c.title || c.uri}"`).join(", ");
    throw new Error(`Refusing to ${action} node ${id} (contains ${node.chips.length} smart chip(s): ${titles}):
` + `Modifying or deleting this node permanently destroys interactive smart chips (Google Docs REST API cannot recreate smart chips).
` + `To proceed intentionally, pass force: true in the op or on the apply document.`);
  }
  if ("kind" in node && node.kind === "tableOfContents" && action === "remove") {
    throw new Error(`Refusing to remove node ${id} (tableOfContents):
` + `Google Docs REST API cannot recreate a Table of Contents.
` + `To remove intentionally, pass force: true in the op or on the apply document.`);
  }
}
var assertNotFragile = notFragileAssert;
function chipWarnings(target, cell, para) {
  const warnings = [];
  const checkNode = (node2) => {
    if (hasChips(node2))
      warnings.push(CHIP_MUTATE_MSG);
    if ("hasEquation" in node2 && node2.hasEquation) {
      warnings.push("Caution: this paragraph contains a math equation. innerText and remove destroy it.");
    }
    if ("hasHorizontalRule" in node2 && node2.hasHorizontalRule) {
      warnings.push("Caution: this paragraph contains a horizontal rule/divider. innerText and remove destroy it.");
    }
  };
  if (!cell) {
    checkNode(target);
    return warnings;
  }
  const hit = target.table?.cells[cell[0]]?.[cell[1]];
  if (!hit)
    return [];
  const node = para ? hit.paragraphs?.[para] ?? hit : hit;
  checkNode(node);
  return warnings;
}
function samePlainText(a, b2) {
  const left = plainVisible(a);
  const right = plainVisible(b2);
  return left.length > 0 && left === right;
}
function plainVisible(s) {
  if (!s)
    return "";
  return InlineMarkup.parse(s).text.replace(/\s+/g, " ").trim().toLowerCase();
}
function targetResolve(dom, op, namedAnchors) {
  const dest = writeAtParse(op.at, namedAnchors);
  if (namedAnchors && typeof op.at === "string" && namedAnchors.has(op.at.trim())) {
    return namedAnchors.get(op.at.trim());
  }
  if (dest.nodeId != null) {
    const hit = dom.nodes.find((n) => n.tapeIndex === dest.nodeId);
    if (hit)
      return hit;
  }
  if (dest.scopedId != null) {
    const hit = dom.nodes.find((n) => n.scopedId === dest.scopedId);
    if (hit)
      return hit;
  }
  if (dest.isHeadingTarget && dest.headingId != null) {
    const hit = dom.nodes.find((n) => n.headingId === dest.headingId);
    if (hit)
      return hit;
  }
  const rawStr = String(dest.rawAt);
  const rawHit = dom.nodes.find((n) => n.scopedId === rawStr || dest.isHeadingTarget && n.headingId === rawStr || String(n.tapeIndex) === rawStr);
  if (rawHit)
    return rawHit;
  if (dest.cell && dest.headingId) {
    const headingIndex = dom.nodes.findIndex((n) => n.headingId === dest.headingId || n.scopedId?.startsWith(`${dest.headingId}.`));
    if (headingIndex >= 0) {
      const startNode = dom.nodes[headingIndex];
      const sectionNodes = neighborhoodFrom(dom.nodes, startNode.tapeIndex);
      const tables = sectionNodes.filter((n) => n.kind === "table");
      const targetTable = tables[(dest.tableIndex ?? 1) - 1];
      if (targetTable)
        return targetTable;
    }
  }
  const titleOrSlugHit = nodeAtFind(dom.nodes, dest.rawAt ?? "");
  if (titleOrSlugHit) {
    if (dest.cell && isHeadingStyle(titleOrSlugHit.namedStyleType)) {
      const sectionNodes = neighborhoodFrom(dom.nodes, titleOrSlugHit.tapeIndex);
      const tables = sectionNodes.filter((n) => n.kind === "table");
      const targetTable = tables[(dest.tableIndex ?? 1) - 1];
      if (targetTable)
        return targetTable;
    }
    return titleOrSlugHit;
  }
  if (dest.nodeId != null) {
    throw new Error(missingNodeIdMsg(dest.nodeId, dom.nodes.length));
  }
  throw new Error(formatMissingScopedTargetMsg(dom.nodes, dest.rawAt ?? ""));
}
function writeAtParse(at2, namedAnchors) {
  if (at2 == null)
    throw new Error(WRITE_AT_ONLY_MSG);
  if (typeof at2 === "number") {
    if (!Number.isInteger(at2) || at2 < 1)
      throw new Error(WRITE_AT_ONLY_MSG);
    return { nodeId: at2 };
  }
  if (typeof at2 !== "string")
    throw new Error(WRITE_AT_ONLY_MSG);
  const trimmed = at2.trim();
  if (!trimmed)
    throw new Error(WRITE_AT_ONLY_MSG);
  if (namedAnchors?.has(trimmed)) {
    const node = namedAnchors.get(trimmed);
    return { nodeId: node.tapeIndex, rawAt: at2, scopedId: node.scopedId };
  }
  if (namedAnchors && trimmed.includes(".")) {
    const dotParts = trimmed.split(".");
    const baseName = dotParts[0];
    if (namedAnchors.has(baseName)) {
      const baseNode = namedAnchors.get(baseName);
      if (dotParts.length === 3 || dotParts.length === 4) {
        const row = Number(dotParts[1]);
        const col = Number(dotParts[2]);
        const para = dotParts[3] != null ? Number(dotParts[3]) : undefined;
        if (Number.isInteger(row) && Number.isInteger(col)) {
          return {
            cell: [row, col],
            nodeId: baseNode.tapeIndex,
            rawAt: at2,
            ...para != null ? { para } : {}
          };
        }
      }
    }
  }
  const parts = trimmed.split(".");
  const isPureNumeric = parts.every((p) => /^\d+$/.test(p));
  if (isPureNumeric) {
    const nums = parts.map((p) => Number(p));
    const nodeId = nums[0];
    if (nodeId < 1)
      throw new Error(WRITE_AT_ONLY_MSG);
    if (parts.length === 1)
      return { nodeId };
    if (parts.length === 3 || parts.length === 4) {
      const row = nums[1];
      const col = nums[2];
      const para = nums[3];
      return {
        cell: [row, col],
        nodeId,
        ...para ? { para } : {}
      };
    }
    throw new Error(WRITE_AT_ONLY_MSG);
  }
  const tableCellMatch = /^(.*?)\.table(\d*)\.(\d+)\.(\d+)(?:\.([a-zA-Z0-9_-]+))?(?:\.(\d+))?$/.exec(trimmed);
  if (tableCellMatch) {
    const headingPart = tableCellMatch[1];
    const tableIdx = tableCellMatch[2] ? Number(tableCellMatch[2]) : 1;
    const row = Number(tableCellMatch[3]);
    const col = Number(tableCellMatch[4]);
    const fourth = tableCellMatch[5];
    const fifth = tableCellMatch[6];
    let para;
    if (fifth != null) {
      para = Number(fifth);
    } else if (fourth != null && /^\d+$/.test(fourth)) {
      para = Number(fourth);
    }
    return {
      cell: [row, col],
      headingId: headingPart,
      para,
      rawAt: at2,
      scopedId: trimmed,
      tableIndex: tableIdx
    };
  }
  const isPreamble = trimmed.startsWith("_preamble");
  let isHeadingDirect = false;
  let headingId;
  if (isPreamble) {
    headingId = "_preamble";
    isHeadingDirect = trimmed === "_preamble";
  } else if (trimmed.startsWith("h.")) {
    if (parts.length <= 2) {
      headingId = trimmed;
      isHeadingDirect = true;
    } else {
      headingId = `${parts[0]}.${parts[1]}`;
      isHeadingDirect = false;
    }
  } else {
    headingId = parts[0];
    isHeadingDirect = parts.length === 1;
  }
  return {
    headingId,
    isHeadingTarget: isHeadingDirect,
    rawAt: at2,
    scopedId: trimmed
  };
}
var parseWriteAt = writeAtParse;
function cellId(tableId, row, col, para = 0) {
  return para ? `${tableId}.${row}.${col}.${para}` : `${tableId}.${row}.${col}`;
}
function styleFromOp(op, index) {
  const patch = { ...op.style };
  const rawAlign = op.alignment ?? op.style?.cellTextAlignment;
  if (rawAlign !== undefined) {
    const alignment = asAlignment(rawAlign);
    if (!alignment) {
      throw new Error(`ops[${index}] unknown alignment: ${rawAlign}`);
    }
    patch.alignment = alignment;
  }
  return hasStyle(patch) ? patch : undefined;
}
function unrecoverableWarningFormat(node) {
  const loc2 = node.scopedId ? `node ${node.scopedId}` : `node ${node.tapeIndex}`;
  if (node.hasEquation) {
    const snippet = (node.text ?? "").trim() ? ` "${(node.text ?? "").trim().slice(0, 40)}"` : "";
    return `Destroyed math equation at ${loc2}${snippet} (unrecoverable via API)`;
  }
  if (node.chips?.length) {
    const titles = node.chips.map((c) => `"${c.title || c.uri}"`).join(", ");
    return `Destroyed ${node.chips.length} smart chip(s) at ${loc2}: ${titles} (unrecoverable via API)`;
  }
  if (node.kind === "tableOfContents") {
    return `Destroyed Table of Contents at ${loc2} (unrecoverable via API)`;
  }
  if (node.hasHorizontalRule) {
    return `Destroyed horizontal rule divider at ${loc2} (unrecoverable via API)`;
  }
  if (node.kind === "table" && node.table) {
    let chipCount = 0;
    for (const r of node.table.cells) {
      for (const c of r) {
        if (c.chips?.length)
          chipCount += c.chips.length;
      }
    }
    if (chipCount > 0) {
      return `Destroyed table with ${chipCount} smart chip(s) at ${loc2} (unrecoverable via API)`;
    }
  }
  return;
}
var formatUnrecoverableWarning = unrecoverableWarningFormat;
function dangerousClearExecute(writer) {
  const nodes = writer.nodes.map((n) => ({ ...n }));
  for (let s = writer.nodes.length - 1;s >= 0; s--) {
    const sNode = writer.nodes[s];
    const sHandle = writer.wrap(sNode);
    const remaining = writer.nodes.filter((n) => n.kind === "paragraph");
    if (sNode.kind === "paragraph" && remaining.length <= 1) {
      if (sNode.bullet)
        delete sNode.bullet;
      sHandle.innerText = "";
      sHandle.namedStyleType = "NORMAL_TEXT";
    } else {
      sHandle.remove();
    }
  }
  return nodes;
}
function nodeSummarize(node, opts = {}) {
  const out = {
    id: node.scopedId ?? node.tapeIndex,
    kind: node.kind
  };
  if (node.namedStyleType)
    out.namedStyleType = node.namedStyleType;
  if (node.row != null)
    out.row = node.row;
  if (node.col != null)
    out.col = node.col;
  if (node.fontColors?.length)
    out.fontColors = node.fontColors;
  if (node.alignment)
    out.alignment = node.alignment;
  if (node.bullet) {
    out.bullet = {
      nestingLevel: node.bullet.nestingLevel,
      ...node.bullet.preset ? { preset: node.bullet.preset } : {},
      ...node.bullet.type ? { type: node.bullet.type } : {}
    };
  }
  if (node.indentStart)
    out.indentStart = node.indentStart.magnitude;
  if (node.indentFirstLine)
    out.indentFirstLine = node.indentFirstLine.magnitude;
  if (node.indentEnd)
    out.indentEnd = node.indentEnd.magnitude;
  if (node.chips?.length) {
    out.chips = node.chips.map((c) => ({ title: c.title, uri: c.uri }));
  }
  if (node.style)
    out.style = node.style;
  if (node.columnCount != null)
    out.columnCount = node.columnCount;
  if (node.footnoteIds?.length)
    out.footnoteIds = node.footnoteIds;
  if (node.hasEquation)
    out.hasEquation = true;
  if (node.hasHorizontalRule)
    out.hasHorizontalRule = true;
  const lossWarnings = [];
  if (node.hasEquation) {
    lossWarnings.push("IMMUTABLE: Contains math equation. API cannot recreate equations if modified or removed.");
  }
  if (node.chips?.length) {
    lossWarnings.push(`FRAGILE: Contains ${node.chips.length} smart chip(s). Modifying text replaces chip with plain text.`);
  }
  if (node.hasHorizontalRule) {
    lossWarnings.push("FRAGILE: Contains horizontal rule divider.");
  }
  if (node.kind === "tableOfContents") {
    lossWarnings.push("IMMUTABLE: Table of contents cannot be recreated via API. Do not remove.");
  }
  if (node.kind === "sectionBreak") {
    lossWarnings.push("CAUTION: Section break controls page layout/margins/headers. Removing merges sections.");
  }
  if (lossWarnings.length > 0) {
    out.lossWarning = lossWarnings.join(" ");
  }
  if (opts.full) {
    if (node.shading)
      out.shading = node.shading;
    if (node.spaceAbove != null)
      out.spaceAbove = node.spaceAbove;
    if (node.spaceBelow != null)
      out.spaceBelow = node.spaceBelow;
    if (node.lineSpacing != null)
      out.lineSpacing = node.lineSpacing;
  }
  if (node.kind === "table" && node.table) {
    out.table = {
      cols: Math.max(0, ...node.table.cells.map((r) => r.length)),
      rows: node.table.cells.length
    };
    if (node.table.columnWidth != null)
      out.table.columnWidth = node.table.columnWidth;
    if (node.table.borderColor)
      out.table.borderColor = node.table.borderColor;
    if (node.table.cellPadding != null)
      out.table.cellPadding = node.table.cellPadding;
    if (node.table.contentAlignment) {
      out.table.contentAlignment = node.table.contentAlignment;
    }
    if (node.table.minRowHeight != null)
      out.table.minRowHeight = node.table.minRowHeight;
    if (node.table.pinnedHeaderRows != null)
      out.table.pinnedHeaderRows = node.table.pinnedHeaderRows;
    if (node.table.preventOverflow != null)
      out.table.preventOverflow = node.table.preventOverflow;
    if (opts.full) {
      out.table.cells = node.table.cells.map((row, r) => row.map((cell, c) => summarizeCell(cell, cellId(node.tapeIndex, r, c))));
    }
  }
  if (node.images?.length) {
    const first = node.images[0];
    out.image = { count: node.images.length };
    if (first.widthPt != null)
      out.image.widthPt = first.widthPt;
    if (first.heightPt != null)
      out.image.heightPt = first.heightPt;
  }
  if (node.kind === "paragraph") {
    const text = node.text ?? "";
    if (opts.full)
      out.text = text;
    else if (text !== "")
      out.text = preview(text);
    if (node.markup)
      out.markup = node.markup;
  }
  return out;
}
var summarizeNode = nodeSummarize;
function summarizeCell(cell, id) {
  const out = { id: cell.scopedId ?? id, text: cell.text };
  if (cell.fontColors?.length)
    out.fontColors = cell.fontColors;
  if (cell.alignment)
    out.alignment = cell.alignment;
  if (cell.indentStart)
    out.indentStart = cell.indentStart.magnitude;
  if (cell.indentFirstLine)
    out.indentFirstLine = cell.indentFirstLine.magnitude;
  if (cell.indentEnd)
    out.indentEnd = cell.indentEnd.magnitude;
  if (cell.markup)
    out.markup = cell.markup;
  if (cell.shading)
    out.shading = cell.shading;
  if (cell.style)
    out.style = cell.style;
  if (cell.images?.length) {
    const first = cell.images[0];
    out.image = { count: cell.images.length };
    if (first.widthPt != null)
      out.image.widthPt = first.widthPt;
    if (first.heightPt != null)
      out.image.heightPt = first.heightPt;
  }
  const extra = "paragraphs" in cell ? (cell.paragraphs ?? []).slice(1) : [];
  if (extra.length) {
    out.paragraphs = extra.map((p, i) => summarizeCell(p, `${id}.${i + 1}`));
  }
  return out;
}
function elementFromJson(raw, force = false) {
  const kind = typeof raw.kind === "string" ? raw.kind : undefined;
  if (kind === "pageBreak") {
    return createElement("pageBreak");
  }
  if (kind === "sectionBreak") {
    return createElement("sectionBreak", {
      sectionType: typeof raw.sectionType === "string" ? raw.sectionType : undefined
    });
  }
  if (kind === "person") {
    return createElement("person", { email: String(raw.email ?? "") });
  }
  if (kind === "richLink") {
    return createElement("richLink", {
      mimeType: typeof raw.mimeType === "string" ? raw.mimeType : undefined,
      title: typeof raw.title === "string" ? raw.title : undefined,
      uri: String(raw.uri ?? "")
    });
  }
  if (kind === "date") {
    return createElement("date", {
      dateFormat: typeof raw.dateFormat === "string" ? raw.dateFormat : undefined,
      displayText: typeof raw.displayText === "string" ? raw.displayText : undefined,
      timestamp: typeof raw.timestamp === "string" ? raw.timestamp : undefined
    });
  }
  if (kind === "footnote") {
    return createElement("footnote", { text: typeof raw.text === "string" ? raw.text : undefined });
  }
  if (kind === "inlineImage") {
    return createElement("inlineImage", {
      heightPt: typeof raw.heightPt === "number" ? raw.heightPt : undefined,
      uri: String(raw.uri ?? ""),
      widthPt: typeof raw.widthPt === "number" ? raw.widthPt : undefined
    });
  }
  if (kind === "codeBlock") {
    return createElement("codeBlock", {
      alignment: typeof raw.alignment === "string" ? asAlignment(raw.alignment) : undefined,
      language: typeof raw.language === "string" ? raw.language : undefined,
      style: raw.style && typeof raw.style === "object" ? raw.style : undefined,
      text: String(raw.text ?? "")
    }, { force });
  }
  if (kind === "table" || kind == null && (Array.isArray(raw.rows) || isNestedTableRows(raw))) {
    const rows = Array.isArray(raw.rows) ? raw.rows : raw.table?.rows;
    if (!Array.isArray(rows)) {
      throw new Error('table element requires rows: { "kind": "table", "rows": [["cell"]] }');
    }
    const warnings = Array.isArray(raw.warnings) ? raw.warnings : undefined;
    const nestedTable = raw.table;
    const cellSpecials = Array.isArray(nestedTable?.cellSpecials) ? nestedTable.cellSpecials : Array.isArray(raw.cellSpecials) ? raw.cellSpecials : undefined;
    return createElement("table", {
      ...cellSpecials ? { cellSpecials } : {},
      rows,
      warnings
    }, { force });
  }
  const props = {
    namedStyleType: raw.namedStyleType,
    text: String(raw.text ?? "")
  };
  if (Array.isArray(raw.warnings)) {
    props.warnings = raw.warnings;
  }
  if (raw.indentStart != null) {
    props.indentStart = raw.indentStart;
  }
  if (raw.bullet === true || raw.bullet && typeof raw.bullet === "object") {
    props.bullet = raw.bullet === true ? {} : raw.bullet;
  }
  if (typeof raw.alignment === "string") {
    const alignment = asAlignment(raw.alignment);
    if (!alignment)
      throw new Error(`Unknown alignment: ${raw.alignment}`);
    props.alignment = alignment;
  }
  if (raw.style && typeof raw.style === "object") {
    props.style = raw.style;
  }
  if (Array.isArray(raw.runs)) {
    props.runs = raw.runs;
  }
  if (Array.isArray(raw.specials)) {
    props.specials = raw.specials;
  }
  return createElement(kind ?? "paragraph", props, { force });
}
function isNestedTableRows(raw) {
  const nested = raw.table;
  return nested != null && typeof nested === "object" && Array.isArray(nested.rows);
}
function summarizeInsert(position, spec) {
  const out = {
    kind: spec.kind,
    position
  };
  if (spec.kind === "paragraph") {
    out.namedStyleType = spec.namedStyleType;
    if (spec.text)
      out.text = preview(spec.text);
    if (spec.bullet)
      out.bullet = true;
  }
  return out;
}
function preview(text) {
  const one = text.split(/\s+/).join(" ").trim();
  if (one.length <= PREVIEW_LEN)
    return one;
  return `${one.slice(0, PREVIEW_LEN - 1)}…`;
}
function markdownParseOptionsFromOp(op, writer) {
  return {
    customStyles: op.markdownStyles ? markdownStylesParse(op.markdownStyles) : undefined,
    h1IsTitle: op.h1IsTitle,
    linkResolver: writer?.linkResolver
  };
}

// src/core/dom/applyCompile.ts
function bulletType(preset) {
  if (!preset)
    return;
  if (preset.startsWith("NUMBERED_"))
    return "NUMBERED";
  if (preset === "BULLET_CHECKBOX")
    return "CHECKBOX";
  return "BULLET";
}
function indentPatchFromSpec(spec) {
  const patch = {};
  if (spec.indentStart)
    patch.indentStart = spec.indentStart.magnitude;
  else if (spec.style?.indentStart != null)
    patch.indentStart = spec.style.indentStart;
  if (spec.style?.indentFirstLine != null) {
    patch.indentFirstLine = spec.style.indentFirstLine;
  }
  if (spec.style?.indentEnd != null)
    patch.indentEnd = spec.style.indentEnd;
  return patch;
}
function domCompile(writer, opts = {}) {
  const force = opts.force ?? writer.force;
  const seg = writer.segmentId;
  const tab = writer.tabId;
  if (!force) {
    for (const m2 of writer.mutations()) {
      if (m2.type === "insertAdjacent" && m2.spec.kind === "paragraph") {
        assertWritable(m2.spec);
      }
      if (m2.type === "innerText") {
        const orig = writer.originalNodes().find((n) => n.tapeIndex === m2.nodeId);
        assertWritable(m2.cell ? { text: m2.text } : {
          bullet: orig?.bullet,
          namedStyleType: orig?.namedStyleType,
          text: m2.text
        });
      }
    }
  }
  assertTableInsertIsolation(writer.mutations());
  const live = new Map;
  for (const n of writer.originalNodes()) {
    live.set(n.tapeIndex, {
      ...n.alignment ? { alignment: n.alignment } : {},
      ...n.bullet ? { bullet: { ...n.bullet } } : {},
      ...n.images ? { images: n.images.map((img) => ({ ...img })) } : {},
      ...n.table?.cells ? { cells: cloneCells(n.table.cells) } : {},
      end: n.end,
      tapeIndex: n.tapeIndex,
      kind: n.kind,
      namedStyleType: n.namedStyleType,
      start: n.start,
      text: n.text
    });
  }
  const requests = [];
  const requestOrigins = [];
  const tableInserts = [];
  const rowFills = [];
  let deleteChars = 0;
  let insertChars = 0;
  let tables = 0;
  let segmentEnd = 1;
  for (const n of writer.originalNodes()) {
    if (n.end > segmentEnd)
      segmentEnd = n.end;
  }
  const push = (reqs, mutationIndexes) => {
    for (const r of reqs) {
      segmentEnd += requestContentDelta(r);
      const range = requestStyleRange(r);
      if (range && !clipStyleRangeToSegment(range, segmentEnd))
        continue;
      requestOrigins.push({ mutationIndexes });
      requests.push(r);
    }
  };
  for (const op of attachJoinListId(coalesce(writer.mutations()), writer.originalNodes())) {
    if (op.type === "innerText") {
      const node = live.get(op.nodeId);
      if (!node)
        throw new Error(`innerText target ${op.nodeId} is gone`);
      if (op.cell) {
        const cell = requireLivePara(node, op.cell, op.para);
        const oldEnd2 = cell.end;
        const cellLive = {
          end: cell.end,
          tapeIndex: node.tapeIndex,
          images: cell.images,
          kind: "paragraph",
          start: cell.start
        };
        const { length: length2, plain: plain2, reqs: reqs2 } = compileInnerText(cellLive, op.text, seg, tab, op.runs);
        push(reqs2, op.mutationIndexes);
        const imageChars2 = imageCharCount(cellLive);
        const oldTextLen2 = Math.max(0, oldEnd2 - cell.start - 1 - imageChars2);
        deleteChars += oldTextLen2;
        insertChars += length2;
        cell.text = plain2;
        packImagesAfterText(cellLive, plain2.length);
        cell.end = cellLive.end;
        cell.images = cellLive.images;
        const delta3 = cell.end - oldEnd2;
        shiftTableCells(node, oldEnd2, delta3, op.cell, op.para);
        node.end += delta3;
        syncTableImages(node);
        shiftLive(live, oldEnd2, delta3, node.tapeIndex);
        continue;
      }
      const oldEnd = node.end;
      const { length, plain, reqs } = compileInnerText(node, op.text, seg, tab, op.runs);
      push(reqs, op.mutationIndexes);
      const imageChars = imageCharCount(node);
      const oldTextLen = Math.max(0, oldEnd - node.start - 1 - imageChars);
      deleteChars += oldTextLen;
      insertChars += length;
      node.text = plain;
      packImagesAfterText(node, plain.length);
      const delta2 = node.end - oldEnd;
      shiftLive(live, oldEnd, delta2, node.tapeIndex);
      continue;
    }
    if (op.type === "style") {
      const node = live.get(op.nodeId);
      if (!node)
        throw new Error(`style target ${op.nodeId} is gone`);
      const range = op.cell ? requireLivePara(node, op.cell, op.para) : node;
      const tableWide = node.kind === "table" && !op.cell;
      push(RequestBuilder.applyStyle({
        cell: op.cell,
        cellRanges: tableWide ? cellParaRanges(node.cells) : undefined,
        end: range.end,
        isBullet: Boolean(!op.cell && node.bullet),
        patch: op.patch,
        segmentId: seg,
        start: range.start,
        tabId: tab,
        tableStart: node.kind === "table" ? node.start : undefined,
        tableWide
      }), op.mutationIndexes);
      if (op.patch.alignment)
        range.alignment = op.patch.alignment;
      continue;
    }
    if (op.type === "bullets") {
      const node = live.get(op.nodeId);
      if (!node)
        throw new Error(`bullets target ${op.nodeId} is gone`);
      const run = liveListRun(live, node);
      const first = run[0];
      const last = run[run.length - 1];
      push([RequestBuilder.createParagraphBullets(first.start, last.end, op.preset, seg, tab)], op.mutationIndexes);
      continue;
    }
    if (op.type === "namedStyleType") {
      const node = live.get(op.nodeId);
      if (!node)
        throw new Error(`namedStyleType target ${op.nodeId} is gone`);
      if (node.kind !== "paragraph") {
        throw new Error("namedStyleType is only supported on paragraph nodes");
      }
      push([RequestBuilder.namedStyle(node.start, node.end, op.namedStyleType, seg, tab)], op.mutationIndexes);
      node.namedStyleType = op.namedStyleType;
      if (isHeadingStyle(op.namedStyleType)) {
        push([RequestBuilder.deleteParagraphBullets(node.start, node.end, seg, tab)], op.mutationIndexes);
        delete node.bullet;
      }
      continue;
    }
    if (op.type === "remove") {
      const node = live.get(op.nodeId);
      if (!node)
        throw new Error(`remove target ${op.nodeId} is gone`);
      if (isLastLiveNode(live, node)) {
        if (node.start > 1) {
          const prev = findPrecedingLiveNode(live, node);
          const len2 = node.end - node.start;
          if (prev && prev.kind === "paragraph") {
            push([
              {
                deleteContentRange: {
                  range: atRng(node.start - 1, node.end - 1, seg, tab)
                }
              }
            ], op.mutationIndexes);
            if (node.namedStyleType !== prev.namedStyleType) {
              push([RequestBuilder.namedStyle(prev.start, node.start, prev.namedStyleType ?? "NORMAL_TEXT", seg, tab)], op.mutationIndexes);
            }
            if (node.bullet && !prev.bullet) {
              push([RequestBuilder.deleteParagraphBullets(prev.start, node.start, seg, tab)], op.mutationIndexes);
            }
            deleteChars += len2;
            shiftLive(live, node.end, -len2, node.tapeIndex);
            live.delete(op.nodeId);
            continue;
          }
        }
        const textLen = Math.max(0, node.end - node.start - 1);
        if (textLen > 0) {
          push([
            {
              deleteContentRange: {
                range: atRng(node.start, node.end - 1, seg, tab)
              }
            }
          ], op.mutationIndexes);
          deleteChars += textLen;
          shiftLive(live, node.end - 1, -textLen, node.tapeIndex);
          node.end -= textLen;
        }
        if (isHeadingStyle(node.namedStyleType)) {
          push([RequestBuilder.namedStyle(node.start, node.end, "NORMAL_TEXT", seg, tab)], op.mutationIndexes);
          node.namedStyleType = "NORMAL_TEXT";
        }
        if (node.bullet) {
          push([RequestBuilder.deleteParagraphBullets(node.start, node.end, seg, tab)], op.mutationIndexes);
          delete node.bullet;
        }
        node.text = "";
        continue;
      }
      const len = node.end - node.start;
      push([
        {
          deleteContentRange: {
            range: atRng(node.start, node.end, seg, tab)
          }
        }
      ], op.mutationIndexes);
      deleteChars += len;
      shiftLive(live, node.end, -len, node.tapeIndex);
      live.delete(op.nodeId);
      continue;
    }
    if (op.type === "insertTable") {
      const anchor2 = live.get(op.afterId);
      if (!anchor2)
        throw new Error(`insert table: missing anchor ${op.afterId}`);
      const { reqs, writeAt: writeAt2 } = compileSplit(anchor2, op.position, seg, tab);
      push(reqs, op.mutationIndexes);
      push([
        {
          insertTable: {
            columns: Math.max(...op.rows.map((r) => r.length), 1),
            location: atLoc(writeAt2, seg, tab),
            rows: op.rows.length
          }
        }
      ], op.mutationIndexes);
      tables += 1;
      tableInserts.push({
        ...op.cellSpecials ? { cellSpecials: op.cellSpecials } : {},
        insertIndex: writeAt2,
        rows: op.rows,
        ...seg ? { segmentId: seg } : {},
        ...tab ? { tabId: tab } : {}
      });
      const created = {
        end: writeAt2 + 1,
        tapeIndex: op.newId,
        kind: "table",
        start: writeAt2
      };
      live.set(created.tapeIndex, created);
      shiftLive(live, writeAt2, 1, created.tapeIndex);
      continue;
    }
    if (op.type === "insertPageBreak") {
      const anchor2 = live.get(op.afterId);
      if (!anchor2)
        throw new Error(`insert pageBreak: missing anchor ${op.afterId}`);
      const { reqs, writeAt: writeAt2 } = compileSplit(anchor2, op.position, seg, tab);
      push(reqs, op.mutationIndexes);
      push([RequestBuilder.insertPageBreak(writeAt2, seg, tab)], op.mutationIndexes);
      insertChars += 1;
      live.set(op.newId, {
        end: writeAt2 + 1,
        tapeIndex: op.newId,
        kind: "pageBreak",
        start: writeAt2
      });
      shiftLive(live, writeAt2, 1, op.newId);
      continue;
    }
    if (op.type === "insertTableRow") {
      const node = live.get(op.nodeId);
      if (!node)
        throw new Error(`insertTableRow target ${op.nodeId} is gone`);
      if (node.kind !== "table")
        throw new Error(`insertTableRow target ${op.nodeId} is not a table`);
      push([
        RequestBuilder.insertTableRow({
          columnIndex: op.cell[1],
          insertBelow: op.insertBelow !== false,
          rowIndex: op.cell[0],
          segmentId: seg,
          tabId: tab,
          tableStart: node.start
        })
      ], op.mutationIndexes);
      if (op.cells && op.cells.length > 0) {
        rowFills.push({
          cells: op.cells,
          insertBelow: op.insertBelow !== false,
          rowIndex: op.cell[0],
          segmentId: seg,
          tabId: tab,
          tableStart: node.start
        });
      }
      continue;
    }
    if (op.type === "deleteTableRow") {
      const node = live.get(op.nodeId);
      if (!node)
        throw new Error(`deleteTableRow target ${op.nodeId} is gone`);
      if (node.kind !== "table")
        throw new Error(`deleteTableRow target ${op.nodeId} is not a table`);
      push([
        RequestBuilder.deleteTableRow({
          columnIndex: op.cell[1],
          rowIndex: op.cell[0],
          segmentId: seg,
          tabId: tab,
          tableStart: node.start
        })
      ], op.mutationIndexes);
      continue;
    }
    if (op.type === "insertTableColumn") {
      const node = live.get(op.nodeId);
      if (!node)
        throw new Error(`insertTableColumn target ${op.nodeId} is gone`);
      if (node.kind !== "table")
        throw new Error(`insertTableColumn target ${op.nodeId} is not a table`);
      push([
        RequestBuilder.insertTableColumn({
          columnIndex: op.cell[1],
          insertRight: op.insertRight !== false,
          rowIndex: op.cell[0],
          segmentId: seg,
          tabId: tab,
          tableStart: node.start
        })
      ], op.mutationIndexes);
      continue;
    }
    if (op.type === "deleteTableColumn") {
      const node = live.get(op.nodeId);
      if (!node)
        throw new Error(`deleteTableColumn target ${op.nodeId} is gone`);
      if (node.kind !== "table")
        throw new Error(`deleteTableColumn target ${op.nodeId} is not a table`);
      push([
        RequestBuilder.deleteTableColumn({
          columnIndex: op.cell[1],
          rowIndex: op.cell[0],
          segmentId: seg,
          tabId: tab,
          tableStart: node.start
        })
      ], op.mutationIndexes);
      continue;
    }
    if (op.type === "insertSectionBreak") {
      const anchor2 = live.get(op.afterId);
      if (!anchor2)
        throw new Error(`insertSectionBreak anchor ${op.afterId} is gone`);
      const splitIdx = op.position === "beforebegin" ? anchor2.start : anchor2.end;
      push([
        RequestBuilder.insertSectionBreak({
          index: splitIdx,
          sectionType: op.sectionType,
          segmentId: seg,
          tabId: tab
        })
      ], op.mutationIndexes);
      live.set(op.newId, {
        end: splitIdx + 1,
        tapeIndex: op.newId,
        kind: "sectionBreak",
        start: splitIdx
      });
      shiftLive(live, splitIdx, 1, op.newId);
      continue;
    }
    if (op.type === "insertPerson") {
      const anchor2 = live.get(op.afterId);
      if (!anchor2)
        throw new Error(`insertPerson anchor ${op.afterId} is gone`);
      const split = compileSplit(anchor2, op.position, seg, tab);
      push(split.reqs, op.mutationIndexes);
      push([
        RequestBuilder.insertPerson({
          email: op.email,
          index: split.writeAt,
          segmentId: seg,
          tabId: tab
        })
      ], op.mutationIndexes);
      live.set(op.newId, {
        end: split.writeAt + 2,
        tapeIndex: op.newId,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: split.writeAt
      });
      shiftLive(live, split.writeAt, 2, op.newId);
      continue;
    }
    if (op.type === "insertRichLink") {
      const anchor2 = live.get(op.afterId);
      if (!anchor2)
        throw new Error(`insertRichLink anchor ${op.afterId} is gone`);
      const split = compileSplit(anchor2, op.position, seg, tab);
      push(split.reqs, op.mutationIndexes);
      push([
        RequestBuilder.insertRichLink({
          index: split.writeAt,
          mimeType: op.mimeType,
          segmentId: seg,
          tabId: tab,
          title: op.title,
          uri: op.uri
        })
      ], op.mutationIndexes);
      live.set(op.newId, {
        end: split.writeAt + 2,
        tapeIndex: op.newId,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: split.writeAt
      });
      shiftLive(live, split.writeAt, 2, op.newId);
      continue;
    }
    if (op.type === "insertDate") {
      const anchor2 = live.get(op.afterId);
      if (!anchor2)
        throw new Error(`insertDate anchor ${op.afterId} is gone`);
      const split = compileSplit(anchor2, op.position, seg, tab);
      push(split.reqs, op.mutationIndexes);
      push([
        RequestBuilder.insertDate({
          dateFormat: op.dateFormat,
          displayText: op.displayText,
          index: split.writeAt,
          segmentId: seg,
          tabId: tab,
          timestamp: op.timestamp
        })
      ], op.mutationIndexes);
      live.set(op.newId, {
        end: split.writeAt + 2,
        tapeIndex: op.newId,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: split.writeAt
      });
      shiftLive(live, split.writeAt, 2, op.newId);
      continue;
    }
    if (op.type === "createFootnote") {
      const anchor2 = live.get(op.afterId);
      if (!anchor2)
        throw new Error(`createFootnote anchor ${op.afterId} is gone`);
      const split = compileSplit(anchor2, op.position, seg, tab);
      push(split.reqs, op.mutationIndexes);
      push([
        RequestBuilder.createFootnote({
          index: split.writeAt,
          segmentId: seg,
          tabId: tab
        })
      ], op.mutationIndexes);
      live.set(op.newId, {
        end: split.writeAt + 2,
        tapeIndex: op.newId,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: split.writeAt
      });
      shiftLive(live, split.writeAt, 2, op.newId);
      continue;
    }
    if (op.type === "insertInlineImage") {
      const anchor2 = live.get(op.afterId);
      if (!anchor2)
        throw new Error(`insertInlineImage anchor ${op.afterId} is gone`);
      const split = compileSplit(anchor2, op.position, seg, tab);
      push(split.reqs, op.mutationIndexes);
      push([
        RequestBuilder.insertInlineImage({
          heightPt: op.heightPt,
          index: split.writeAt,
          segmentId: seg,
          tabId: tab,
          uri: op.uri,
          widthPt: op.widthPt
        })
      ], op.mutationIndexes);
      live.set(op.newId, {
        end: split.writeAt + 2,
        tapeIndex: op.newId,
        kind: "paragraph",
        namedStyleType: "NORMAL_TEXT",
        start: split.writeAt
      });
      shiftLive(live, split.writeAt, 2, op.newId);
      continue;
    }
    const anchor = live.get(op.afterId);
    if (!anchor) {
      throw new Error(`insert paragraphs: missing anchor ${op.afterId}`);
    }
    const { reqs: splitReqs, writeAt } = compileSplit(anchor, op.position, seg, tab);
    push(splitReqs, op.mutationIndexes);
    insertChars += 1;
    const allBullets = op.specs.length > 0 && op.specs.every((s) => s.bullet);
    const inheritedList = op.position === "afterend" && anchor.kind === "paragraph" && Boolean(anchor.bullet);
    const neighborLevel = anchor.bullet?.nestingLevel ?? 0;
    const firstSpec = op.specs[0];
    const firstPreset = firstSpec?.bullet?.preset;
    const specBulletType = firstPreset ? bulletType(firstPreset) : undefined;
    const anchorBulletType = anchor.bullet?.type ?? (anchor.bullet?.preset ? bulletType(anchor.bullet.preset) : undefined);
    const sameBulletType = !anchorBulletType || !specBulletType || anchorBulletType === specBulletType;
    const samePreset = !anchor.bullet?.preset || !firstPreset || anchor.bullet.preset === firstPreset;
    const peerJoin = allBullets && inheritedList && sameBulletType && samePreset && op.specs.every((s) => (s.bullet?.nestingLevel ?? 0) === neighborLevel);
    const parsed = parseSpecsInline(op.specs, {
      leadingTabs: allBullets && !peerJoin
    });
    if (parsed.plain.length) {
      push([
        {
          insertText: {
            location: atLoc(writeAt, seg, tab),
            text: parsed.plain
          }
        }
      ], op.mutationIndexes);
      insertChars += parsed.plain.length;
      push([RequestBuilder.clearInlineStyles(writeAt, writeAt + parsed.plain.length, seg, tab)], op.mutationIndexes);
    }
    const rangeEnd = writeAt + parsed.plain.length + 1;
    const style2 = op.specs[0]?.namedStyleType ?? "NORMAL_TEXT";
    push([RequestBuilder.namedStyle(writeAt, rangeEnd, style2, seg, tab)], op.mutationIndexes);
    {
      let offset = 0;
      for (let i = 0;i < op.specs.length; i++) {
        const spec = op.specs[i];
        const start = writeAt + offset;
        const end = start + parsed.plains[i]?.length + 1;
        const patch = omitIndent({
          ...spec.alignment ? { alignment: spec.alignment } : {},
          ...spec.style
        });
        if (Object.keys(patch).length) {
          push(RequestBuilder.applyStyle({ end, patch, segmentId: seg, start, tabId: tab }), op.mutationIndexes);
        }
        offset += parsed.plains[i]?.length + 1;
      }
    }
    push(RequestBuilder.buildTextStyles(writeAt, parsed.runs, seg, tab), op.mutationIndexes);
    if (allBullets && !peerJoin) {
      const preset = op.specs[0]?.bullet?.preset ?? "BULLET_DISC_CIRCLE_SQUARE";
      push([RequestBuilder.deleteParagraphBullets(writeAt, rangeEnd, seg, tab)], op.mutationIndexes);
      push([RequestBuilder.createParagraphBullets(writeAt, rangeEnd, preset, seg, tab)], op.mutationIndexes);
    } else if (!allBullets) {
      push([RequestBuilder.deleteParagraphBullets(writeAt, rangeEnd, seg, tab)], op.mutationIndexes);
    }
    {
      let offset = 0;
      for (let i = 0;i < op.specs.length; i++) {
        const spec = op.specs[i];
        const start = writeAt + offset;
        const end = start + parsed.plains[i]?.length + 1;
        const indentPatch = indentPatchFromSpec(spec);
        if (hasIndent(indentPatch)) {
          push(RequestBuilder.applyStyle({
            end,
            isBullet: Boolean(spec.bullet),
            patch: indentPatch,
            segmentId: seg,
            start,
            tabId: tab
          }), op.mutationIndexes);
        }
        offset += parsed.plains[i]?.length + 1;
      }
    }
    const specialCount = op.specs.reduce((n, s) => n + (s.specials?.length ?? 0), 0);
    if (specialCount > 0) {
      let specialOffset = 0;
      const specialStarts = [];
      for (let i = 0;i < op.specs.length; i++) {
        const spec = op.specs[i];
        const tabs = allBullets && !peerJoin && spec.bullet ? spec.bullet.nestingLevel : 0;
        specialStarts.push({ index: writeAt + specialOffset + tabs, specials: spec.specials });
        specialOffset += parsed.plains[i]?.length + 1;
      }
      for (let i = specialStarts.length - 1;i >= 0; i--) {
        const item = specialStarts[i];
        push(RequestBuilder.insertInlineSpecials({
          index: item.index,
          segmentId: seg,
          specials: item.specials,
          tabId: tab
        }), op.mutationIndexes);
      }
      insertChars += specialCount;
    }
    const delta = 1 + parsed.bodies.join(`
`).length + specialCount;
    let cursor = writeAt;
    for (let i = 0;i < op.specs.length; i++) {
      const spec = op.specs[i];
      const id = op.ids[i];
      const start = cursor;
      const nSpecials = spec.specials?.length ?? 0;
      const end = start + parsed.bodies[i]?.length + 1 + nSpecials;
      live.set(id, {
        ...spec.alignment ? { alignment: spec.alignment } : {},
        ...spec.bullet ? {
          bullet: {
            ...op.joinListId ? { listId: op.joinListId } : {},
            nestingLevel: spec.bullet.nestingLevel,
            preset: spec.bullet.preset,
            type: bulletType(spec.bullet.preset)
          }
        } : {},
        end,
        kind: "paragraph",
        namedStyleType: spec.namedStyleType,
        start,
        tapeIndex: id,
        text: parsed.bodies[i]
      });
      cursor = end;
    }
    shiftLive(live, writeAt, delta, ...op.ids);
  }
  return {
    requestOrigins,
    requests,
    rowFills: rowFills.length ? rowFills : undefined,
    summary: {
      deleteChars,
      insertChars,
      requestCount: requests.length,
      tables
    },
    tableInserts
  };
}
var compileDom = domCompile;
function coalesce(mutations) {
  const out = [];
  let i = 0;
  while (i < mutations.length) {
    const m2 = mutations[i];
    if (m2.type === "innerText" || m2.type === "remove" || m2.type === "namedStyleType" || m2.type === "style" || m2.type === "bullets" || m2.type === "insertTableRow" || m2.type === "deleteTableRow" || m2.type === "insertTableColumn" || m2.type === "deleteTableColumn") {
      out.push({ ...m2, mutationIndexes: [m2.opIndex ?? i] });
      i++;
      continue;
    }
    if (m2.spec.kind === "pageBreak") {
      out.push({
        afterId: m2.anchorId,
        mutationIndexes: [m2.opIndex ?? i],
        newId: m2.newId,
        position: m2.position,
        type: "insertPageBreak"
      });
      i++;
      continue;
    }
    if (m2.spec.kind === "sectionBreak") {
      out.push({
        afterId: m2.anchorId,
        mutationIndexes: [m2.opIndex ?? i],
        newId: m2.newId,
        position: m2.position,
        sectionType: m2.spec.sectionType,
        type: "insertSectionBreak"
      });
      i++;
      continue;
    }
    if (m2.spec.kind === "person") {
      out.push({
        afterId: m2.anchorId,
        email: m2.spec.email,
        mutationIndexes: [m2.opIndex ?? i],
        newId: m2.newId,
        position: m2.position,
        type: "insertPerson"
      });
      i++;
      continue;
    }
    if (m2.spec.kind === "richLink") {
      out.push({
        afterId: m2.anchorId,
        mimeType: m2.spec.mimeType,
        mutationIndexes: [m2.opIndex ?? i],
        newId: m2.newId,
        position: m2.position,
        title: m2.spec.title,
        type: "insertRichLink",
        uri: m2.spec.uri
      });
      i++;
      continue;
    }
    if (m2.spec.kind === "date") {
      out.push({
        afterId: m2.anchorId,
        dateFormat: m2.spec.dateFormat,
        displayText: m2.spec.displayText,
        mutationIndexes: [m2.opIndex ?? i],
        newId: m2.newId,
        position: m2.position,
        timestamp: m2.spec.timestamp,
        type: "insertDate"
      });
      i++;
      continue;
    }
    if (m2.spec.kind === "footnote") {
      out.push({
        afterId: m2.anchorId,
        mutationIndexes: [m2.opIndex ?? i],
        newId: m2.newId,
        position: m2.position,
        text: m2.spec.text,
        type: "createFootnote"
      });
      i++;
      continue;
    }
    if (m2.spec.kind === "inlineImage") {
      out.push({
        afterId: m2.anchorId,
        heightPt: m2.spec.heightPt,
        mutationIndexes: [m2.opIndex ?? i],
        newId: m2.newId,
        position: m2.position,
        type: "insertInlineImage",
        uri: m2.spec.uri,
        widthPt: m2.spec.widthPt
      });
      i++;
      continue;
    }
    if (m2.spec.kind === "table") {
      out.push({
        afterId: m2.anchorId,
        ...m2.spec.table.cellSpecials ? { cellSpecials: m2.spec.table.cellSpecials } : {},
        mutationIndexes: [m2.opIndex ?? i],
        newId: m2.newId,
        position: m2.position,
        rows: m2.spec.table.rows,
        type: "insertTable"
      });
      i++;
      continue;
    }
    if (!m2.spec.bullet) {
      out.push({
        afterId: m2.anchorId,
        ids: [m2.newId],
        mutationIndexes: [m2.opIndex ?? i],
        position: m2.position,
        specs: [m2.spec],
        type: "insertParagraphs"
      });
      i++;
      continue;
    }
    const run = [m2];
    let j = i + 1;
    while (j < mutations.length) {
      const next = mutations[j];
      if (next.type !== "insertAdjacent")
        break;
      if (next.spec.kind !== "paragraph" || !next.spec.bullet)
        break;
      const prev = run[run.length - 1];
      if (next.position !== "afterend" || next.anchorId !== prev.newId)
        break;
      if (next.spec.bullet.preset !== m2.spec.bullet.preset)
        break;
      run.push(next);
      j++;
    }
    out.push({
      afterId: m2.anchorId,
      ids: run.map((r) => r.newId),
      mutationIndexes: run.map((r, k) => r.opIndex ?? i + k),
      position: m2.position,
      specs: run.map((r) => r.spec),
      type: "insertParagraphs"
    });
    i = j;
  }
  return out;
}
function compileSplit(anchor, position, segmentId, tabId) {
  if (position === "beforebegin") {
    return {
      reqs: [RequestBuilder.splitBefore(anchor.start, segmentId, tabId)],
      writeAt: anchor.start
    };
  }
  if (anchor.kind !== "paragraph") {
    return {
      reqs: [RequestBuilder.splitBefore(anchor.end, segmentId, tabId)],
      writeAt: anchor.end
    };
  }
  return {
    reqs: [RequestBuilder.splitAfter(anchor.end, segmentId, tabId)],
    writeAt: anchor.end
  };
}
function compileInnerText(node, text, segmentId, tabId, customRuns) {
  const { runs: parsedRuns, text: plain } = InlineMarkup.parse(text);
  const runs = InlineMarkup.resolveRuns(plain, parsedRuns, customRuns);
  const images = [...node.images ?? []].sort((a, b2) => a.start - b2.start);
  const reqs = images.length ? replaceTextKeepingImages(node, plain, images, segmentId, tabId) : RequestBuilder.replaceInnerText(node.start, node.end, plain, segmentId, tabId);
  if (plain.length) {
    reqs.push(RequestBuilder.clearInlineStyles(node.start, node.start + plain.length, segmentId, tabId));
  }
  reqs.push(...RequestBuilder.buildTextStyles(node.start, runs, segmentId, tabId));
  return { length: plain.length, plain, reqs };
}
function replaceTextKeepingImages(node, plain, images, segmentId, tabId) {
  const contentEnd = Math.max(node.start, node.end - 1);
  const gaps = [];
  let cursor = node.start;
  for (const img of images) {
    if (img.start > cursor)
      gaps.push({ end: img.start, start: cursor });
    cursor = Math.max(cursor, img.end);
  }
  if (contentEnd > cursor)
    gaps.push({ end: contentEnd, start: cursor });
  const reqs = [];
  for (const gap of gaps.reverse()) {
    if (gap.end > gap.start) {
      reqs.push({
        deleteContentRange: {
          range: atRng(gap.start, gap.end, segmentId, tabId)
        }
      });
    }
  }
  if (plain.length) {
    reqs.push({
      insertText: {
        location: atLoc(node.start, segmentId, tabId),
        text: plain
      }
    });
  }
  return reqs;
}
function atLoc(index, segmentId, tabId) {
  return {
    index,
    ...segmentId ? { segmentId } : {},
    ...tabId ? { tabId } : {}
  };
}
function atRng(startIndex, endIndex, segmentId, tabId) {
  return {
    endIndex,
    startIndex,
    ...segmentId ? { segmentId } : {},
    ...tabId ? { tabId } : {}
  };
}
function imageCharCount(node) {
  let n = 0;
  for (const img of node.images ?? [])
    n += Math.max(0, img.end - img.start);
  return n;
}
function packImagesAfterText(node, plainLen) {
  const images = node.images;
  if (!images?.length) {
    node.end = node.start + plainLen + 1;
    return;
  }
  let pos = node.start + plainLen;
  for (const img of [...images].sort((a, b2) => a.start - b2.start)) {
    const w = Math.max(1, img.end - img.start);
    img.start = pos;
    img.end = pos + w;
    pos += w;
  }
  node.end = pos + 1;
}
function parseSpecsInline(specs, opts = {}) {
  let offset = 0;
  const bodies = [];
  const plains = [];
  const runs = [];
  for (const spec of specs) {
    const parsed = InlineMarkup.parse(spec.text);
    const resolvedRuns = InlineMarkup.resolveRuns(parsed.text, parsed.runs, spec.runs);
    const tabs = opts.leadingTabs && spec.bullet ? "\t".repeat(spec.bullet.nestingLevel) : "";
    for (const run of resolvedRuns) {
      runs.push({
        ...run,
        end: run.end + offset + tabs.length,
        start: run.start + offset + tabs.length
      });
    }
    bodies.push(parsed.text);
    plains.push(`${tabs}${parsed.text}`);
    offset += tabs.length + parsed.text.length + 1;
  }
  return { bodies, plain: plains.join(`
`), plains, runs };
}
function assertTableInsertIsolation(mutations) {
  const tableIds = new Set;
  for (const m2 of mutations) {
    if (m2.type === "insertAdjacent" && m2.spec.kind === "table") {
      tableIds.add(m2.newId);
    }
  }
  if (!tableIds.size)
    return;
  for (const m2 of mutations) {
    if (m2.type === "insertAdjacent" && m2.spec.kind === "table")
      continue;
    if (m2.type === "style" && tableIds.has(m2.nodeId) && !m2.cell)
      continue;
    throw new Error(TABLE_INSERT_MIX_MSG);
  }
}
function liveListRun(live, node) {
  const listId = node.bullet?.listId;
  if (!listId)
    return [node];
  return [...live.values()].filter((n) => n.bullet?.listId === listId).sort((a, b2) => a.start - b2.start);
}
function cellParaRanges(cells) {
  const out = [];
  for (const row of cells ?? []) {
    for (const cell of row) {
      for (const p of cell.paragraphs ?? [cell]) {
        if (p.start >= 0 && p.end > p.start)
          out.push({ end: p.end, start: p.start });
      }
    }
  }
  return out;
}
function findPrecedingLiveNode(live, node) {
  let prev;
  for (const n of live.values()) {
    if (n.tapeIndex !== node.tapeIndex && n.end <= node.start) {
      if (!prev || n.end > prev.end) {
        prev = n;
      }
    }
  }
  return prev;
}
function isLastLiveNode(live, node) {
  for (const n of live.values()) {
    if (n.tapeIndex !== node.tapeIndex && n.start > node.start)
      return false;
  }
  return true;
}
function shiftLive(live, fromIndex, delta, ...except) {
  if (!delta)
    return;
  const skip = new Set(except);
  for (const n of live.values()) {
    if (skip.has(n.tapeIndex))
      continue;
    if (n.start >= fromIndex) {
      n.start += delta;
      n.end += delta;
      shiftImages(n, fromIndex, delta);
      shiftTableCells(n, fromIndex, delta);
    } else if (n.end > fromIndex) {
      n.end += delta;
      shiftImages(n, fromIndex, delta);
      shiftTableCells(n, fromIndex, delta);
    }
  }
}
function shiftImages(node, fromIndex, delta) {
  for (const img of node.images ?? []) {
    if (img.start >= fromIndex) {
      img.start += delta;
      img.end += delta;
    } else if (img.end > fromIndex) {
      img.end += delta;
    }
  }
}
function cloneCells(cells) {
  return cells.map((row) => row.map((cell) => ({
    ...cell,
    paragraphs: (cell.paragraphs ?? [{ ...cell }]).map((p) => ({
      ...p,
      ...p.images ? { images: p.images.map((img) => ({ ...img })) } : {}
    })),
    ...cell.images ? { images: cell.images.map((img) => ({ ...img })) } : {}
  })));
}
function requireLiveCell(node, cell) {
  if (node.kind !== "table" || !node.cells) {
    throw new Error("cell: [row, col] is only valid on a table node");
  }
  const [r, c] = cell;
  const hit = node.cells[r]?.[c];
  if (!hit) {
    throw new Error(`No cell [${r}, ${c}] — table is ${node.cells.length}×${node.cells[0]?.length ?? 0}`);
  }
  if (!hit.paragraphs?.length) {
    hit.paragraphs = [{ end: hit.end, start: hit.start, text: hit.text }];
  }
  return hit;
}
function requireLivePara(node, cell, para) {
  const tableCell = requireLiveCell(node, cell);
  const i = para ?? 0;
  const hit = tableCell.paragraphs[i];
  if (!hit) {
    throw new Error(`No paragraph ${i} in cell [${cell[0]}, ${cell[1]}] (${tableCell.paragraphs.length} paragraphs)`);
  }
  return hit;
}
function shiftTableCells(node, fromIndex, delta, except, exceptPara) {
  if (!delta || !node.cells)
    return;
  const skipPara = exceptPara ?? 0;
  for (let r = 0;r < node.cells.length; r++) {
    const row = node.cells[r];
    for (let c = 0;c < row.length; c++) {
      const cell = row[c];
      const paras = cell.paragraphs ?? [cell];
      for (let p = 0;p < paras.length; p++) {
        if (except && except[0] === r && except[1] === c && p === skipPara)
          continue;
        const para = paras[p];
        if (para.start >= fromIndex) {
          para.start += delta;
          para.end += delta;
          shiftImages(para, fromIndex, delta);
        } else if (para.end > fromIndex) {
          para.end += delta;
          shiftImages(para, fromIndex, delta);
        }
      }
      const head = paras[0];
      if (head) {
        cell.start = head.start;
        cell.end = paras[paras.length - 1]?.end;
        cell.images = head.images;
        cell.text = head.text;
      }
    }
  }
}
function syncTableImages(node) {
  if (!node.cells)
    return;
  const images = [];
  for (let r = 0;r < node.cells.length; r++) {
    const row = node.cells[r];
    for (let c = 0;c < row.length; c++) {
      for (const img of row[c]?.images ?? []) {
        images.push({ ...img, col: c, row: r });
      }
    }
  }
  if (images.length)
    node.images = images;
  else
    delete node.images;
}
function clipStyleRangeToSegment(range, segmentEnd) {
  const maxEnd = segmentEnd - 1;
  if (range.endIndex > maxEnd)
    range.endIndex = maxEnd;
  return range.endIndex > range.startIndex;
}
function requestContentDelta(request) {
  if ("insertText" in request) {
    const text = request.insertText.text;
    return typeof text === "string" ? text.length : 0;
  }
  if ("insertPageBreak" in request || "insertSectionBreak" in request)
    return 1;
  if ("insertPerson" in request || "insertDate" in request || "insertRichLink" in request || "insertInlineImage" in request) {
    return 1;
  }
  if ("deleteContentRange" in request) {
    const range = request.deleteContentRange.range;
    return -(range.endIndex - range.startIndex);
  }
  return 0;
}
function requestStyleRange(request) {
  if ("updateParagraphStyle" in request) {
    return request.updateParagraphStyle.range;
  }
  if ("updateTextStyle" in request) {
    return request.updateTextStyle.range;
  }
  if ("createParagraphBullets" in request) {
    return request.createParagraphBullets.range;
  }
  if ("deleteParagraphBullets" in request) {
    return request.deleteParagraphBullets.range;
  }
  return;
}
function attachJoinListId(ops, original) {
  const byId = new Map(original.map((n) => [n.tapeIndex, n]));
  return ops.map((op) => {
    if (op.type !== "insertParagraphs")
      return op;
    if (!op.specs[0]?.bullet)
      return op;
    const anchor = byId.get(op.afterId);
    const listId = anchor?.bullet?.listId;
    if (!listId)
      return op;
    return { ...op, joinListId: listId };
  });
}

// src/core/dom/applyBatch.ts
function documentStyleRequestBuilder(pageSetup, tabId) {
  const mode = pageSetup.mode ?? (pageSetup.pageless !== undefined ? pageSetup.pageless ? "PAGELESS" : "PAGES" : undefined);
  const documentStyle = {};
  const fields = [];
  if (mode) {
    const normalizedMode = mode.toUpperCase();
    if (normalizedMode !== "PAGES" && normalizedMode !== "PAGELESS") {
      throw new Error(`Invalid document mode "${mode}". Expected "PAGES" or "PAGELESS".`);
    }
    documentStyle.documentFormat = {
      documentMode: normalizedMode
    };
    fields.push("documentFormat.documentMode");
  }
  if (pageSetup.margins) {
    if (pageSetup.margins.top != null) {
      documentStyle.marginTop = pt2(pageSetup.margins.top);
      fields.push("marginTop");
    }
    if (pageSetup.margins.bottom != null) {
      documentStyle.marginBottom = pt2(pageSetup.margins.bottom);
      fields.push("marginBottom");
    }
    if (pageSetup.margins.left != null) {
      documentStyle.marginLeft = pt2(pageSetup.margins.left);
      fields.push("marginLeft");
    }
    if (pageSetup.margins.right != null) {
      documentStyle.marginRight = pt2(pageSetup.margins.right);
      fields.push("marginRight");
    }
  }
  if (pageSetup.orientation || pageSetup.pageSize || pageSetup.pageWidth != null || pageSetup.pageHeight != null) {
    let w = pageSetup.pageWidth ?? (pageSetup.orientation === "LANDSCAPE" ? 792 : 612);
    let h = pageSetup.pageHeight ?? (pageSetup.orientation === "LANDSCAPE" ? 612 : 792);
    if (pageSetup.pageSize === "LEGAL") {
      w = pageSetup.orientation === "LANDSCAPE" ? 1008 : 612;
      h = pageSetup.orientation === "LANDSCAPE" ? 612 : 1008;
    } else if (pageSetup.pageSize === "TABLOID") {
      w = pageSetup.orientation === "LANDSCAPE" ? 1224 : 792;
      h = pageSetup.orientation === "LANDSCAPE" ? 792 : 1224;
    } else if (pageSetup.pageSize === "A4") {
      w = pageSetup.orientation === "LANDSCAPE" ? 841.89 : 595.28;
      h = pageSetup.orientation === "LANDSCAPE" ? 595.28 : 841.89;
    }
    documentStyle.pageSize = {
      height: pt2(h),
      width: pt2(w)
    };
    fields.push("pageSize");
  }
  if (!fields.length) {
    return {};
  }
  return RequestBuilder.updateDocumentStyle({
    documentStyle,
    fields: fields.join(","),
    tabId
  });
}
var buildDocumentStyleRequest = documentStyleRequestBuilder;
async function domApply(documentId, writer, opts = {}) {
  const client = opts.client ?? gws;
  const writers = Array.isArray(writer) ? writer : [writer];
  const compiled = mergeCompiled(writers.map((w) => compileDom(w, { force: opts.force, lists: opts.doc?.lists ?? w.lists })));
  if (opts.pageSetup) {
    const styleReq = buildDocumentStyleRequest(opts.pageSetup, writers[0]?.tabId);
    if ("updateDocumentStyle" in styleReq) {
      compiled.requests.unshift(styleReq);
      compiled.requestOrigins.unshift({ mutationIndexes: [] });
      compiled.summary.requestCount = compiled.requests.length;
    }
  }
  if (opts.dryRun || !compiled.requests.length)
    return compiled;
  try {
    await client.batchUpdate(documentId, compiled.requests, {
      requiredRevisionId: opts.doc?.revisionId
    });
  } catch (err) {
    if (isRevisionMismatchError(err)) {
      throw err;
    }
    throw wrapBatchUpdateError(err, {
      batch: "main",
      origins: compiled.requestOrigins,
      plan: opts.plan
    });
  }
  for (const table of compiled.tableInserts) {
    try {
      const loaded = await Gdoc.load(documentId, client, { forceFetch: true });
      const data = loaded.data;
      const gdoc = table.tabId ? loaded.withTab(table.tabId) : loaded;
      const tableEl = gdoc.findInsertedTableAt(table.insertIndex) ?? gdoc.findTableAt(table.insertIndex);
      if (!tableEl?.table)
        continue;
      const fill = RequestBuilder.buildTableFill(table.rows.length > 1, table.rows, tableEl, table.segmentId, table.tabId, table.cellSpecials);
      if (fill.length) {
        await client.batchUpdate(documentId, fill, {
          requiredRevisionId: data.revisionId
        });
      }
    } catch (err) {
      throw wrapBatchUpdateError(err, { batch: "table-fill", plan: opts.plan });
    }
  }
  if (compiled.rowFills && compiled.rowFills.length > 0) {
    try {
      const loaded = await Gdoc.load(documentId, client, { forceFetch: true });
      const data = loaded.data;
      const rowFillReqs = [];
      for (const fill of compiled.rowFills) {
        const gdoc = fill.tabId ? loaded.withTab(fill.tabId) : loaded;
        const tableEl = gdoc.findTableAt(fill.tableStart);
        if (!tableEl?.table?.tableRows)
          continue;
        const targetRowIdx = fill.insertBelow ? fill.rowIndex + 1 : fill.rowIndex;
        const row = tableEl.table.tableRows[targetRowIdx];
        if (!row?.tableCells)
          continue;
        const cellsToFill = [];
        for (let c = 0;c < fill.cells.length; c++) {
          const text = fill.cells[c];
          if (!text)
            continue;
          const cell = row.tableCells[c];
          if (!cell)
            continue;
          const idx = RequestBuilder.cellInsertIndex(cell);
          cellsToFill.push({ idx, text });
        }
        cellsToFill.sort((a, b2) => b2.idx - a.idx);
        for (const item of cellsToFill) {
          const { runs, text: plain } = InlineMarkup.parse(item.text);
          const line = plain.endsWith(`
`) ? plain : `${plain}
`;
          rowFillReqs.push({
            insertText: {
              location: {
                index: item.idx,
                ...fill.segmentId ? { segmentId: fill.segmentId } : {},
                ...fill.tabId ? { tabId: fill.tabId } : {}
              },
              text: line
            }
          });
          const textEnd = item.idx + Math.max(0, line.length - (line.endsWith(`
`) ? 1 : 0));
          if (textEnd > item.idx) {
            rowFillReqs.push(RequestBuilder.clearInlineStyles(item.idx, textEnd, fill.segmentId, fill.tabId));
          }
          rowFillReqs.push(...RequestBuilder.textStyleRequests(item.idx, runs, fill.segmentId, fill.tabId));
        }
      }
      if (rowFillReqs.length > 0) {
        await client.batchUpdate(documentId, rowFillReqs, {
          requiredRevisionId: data.revisionId
        });
      }
    } catch (err) {
      throw wrapBatchUpdateError(err, { batch: "table-fill", plan: opts.plan });
    }
  }
  return compiled;
}
var applyDom = domApply;
function mergeCompiled(parts) {
  const out = {
    requestOrigins: [],
    requests: [],
    summary: { deleteChars: 0, insertChars: 0, requestCount: 0, tables: 0 },
    tableInserts: []
  };
  for (const part of parts) {
    out.requests.push(...part.requests);
    out.requestOrigins.push(...part.requestOrigins);
    out.tableInserts.push(...part.tableInserts);
    if (part.rowFills) {
      out.rowFills = [...out.rowFills ?? [], ...part.rowFills];
    }
    out.summary.deleteChars += part.summary.deleteChars;
    out.summary.insertChars += part.summary.insertChars;
    out.summary.tables += part.summary.tables;
  }
  out.summary.requestCount = out.requests.length;
  return out;
}
function batchUpdateErrorWrap(err, opts) {
  const raw = err instanceof Error ? err.message : String(err);
  if (opts.batch === "table-fill") {
    return new Error(`${raw}
Failed during table cell fill (second batchUpdate). The table may already exist from the first call. Restore the pinned revision if the Doc looks half-written.`);
  }
  const idx = parseGoogleRequestIndex(raw);
  const origin = idx != null && opts.origins ? opts.origins[idx] : undefined;
  const ops = origin?.mutationIndexes ?? [];
  const labels = ops.map((i) => {
    const p = opts.plan?.find((op) => op.index === i);
    if (!p)
      return `ops[${i}]`;
    const preview2 = p.target.text ?? p.target.namedStyleType ?? "";
    return `ops[${i}] ${p.action} #${p.target.id}${preview2 ? ` ${JSON.stringify(preview2)}` : ""}`;
  });
  const where = idx != null ? `API requests[${idx}]${labels.length ? ` ← ${labels.join("; ")}` : ""}. ` : "";
  return new Error(`${where}${raw}
That batchUpdate is atomic — none of its requests applied.`);
}
var wrapBatchUpdateError = batchUpdateErrorWrap;
function googleRequestIndexParse(message) {
  const m2 = /\brequests\[(\d+)\]/.exec(message);
  if (!m2)
    return;
  return Number(m2[1]);
}
function isRevisionMismatchError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Failed during table cell fill"))
    return false;
  return /revision (ID )?provided.*does not match|writeControl.*revision|write control.*does not match/i.test(msg);
}
var parseGoogleRequestIndex = googleRequestIndexParse;

// src/core/dom/write.ts
class DomWriter {
  doc;
  force;
  linkResolver;
  lists;
  segmentId;
  tabId;
  #mutations = [];
  #nodes;
  #original;
  #nextId;
  #nextOpIndex;
  constructor(nodes, opts = {}) {
    this.doc = opts.doc;
    this.force = opts.force ?? false;
    this.lists = opts.lists;
    this.segmentId = opts.segmentId;
    this.tabId = opts.tabId;
    this.linkResolver = opts.linkResolver ?? (opts.doc || nodes.length ? createSymbolicLinkResolver({
      currentTabId: opts.tabId,
      doc: opts.doc,
      nodes,
      simulatedTabs: opts.simulatedTabs
    }) : undefined);
    this.#original = nodes.map(cloneNode);
    this.#nodes = nodes.map(cloneNode);
    this.#nextId = nodes.reduce((m2, n) => Math.max(m2, n.tapeIndex), 0) + 1;
  }
  originalNodes() {
    return this.#original.map(cloneNode);
  }
  get nodes() {
    return this.#nodes;
  }
  mutations() {
    return [...this.#mutations];
  }
  setNextOpIndex(index) {
    this.#nextOpIndex = index;
  }
  createElement(...args) {
    const [kind, props, opts] = args;
    return createElement(kind, props, { force: this.force, ...opts });
  }
  wrap(node) {
    const live = this.#find(node.tapeIndex);
    if (!live)
      throw new Error(`Node ${node.tapeIndex} is not in the tape`);
    return new DomHandle(this, live);
  }
  insertAdjacentElement(anchor, position, element) {
    if (position === "afterbegin" || position === "beforeend") {
      const heading = isHeadingStyle(this.#find(anchor.tapeIndex)?.namedStyleType);
      throw new Error(heading ? `insertAdjacentElement("${position}") would write inside the heading. Use beforebegin/afterend (siblings).` : `insertAdjacentElement("${position}") is not a sibling insert. Use beforebegin/afterend.`);
    }
    const live = this.#find(anchor.tapeIndex);
    if (!live)
      throw new Error(`Anchor ${anchor.tapeIndex} is not in the tape`);
    if (element.kind === "paragraph") {
      assertWritable(element, { force: this.force });
    }
    const created = specToNode(element, this.#nextId++);
    this.#push({
      anchorId: live.tapeIndex,
      newId: created.tapeIndex,
      position,
      spec: element,
      type: "insertAdjacent"
    });
    const i = this.#nodes.findIndex((n) => n.tapeIndex === live.tapeIndex);
    const at2 = position === "beforebegin" ? i : i + 1;
    this.#nodes.splice(at2, 0, created);
    return created;
  }
  setInnerText(node, text, cell, para, opts) {
    const live = this.#find(node.tapeIndex);
    if (!live)
      throw new Error(`Node ${node.tapeIndex} is not in the tape`);
    const next = stripTrailingNewline(text);
    if (cell) {
      const target = requireCellPara(live, cell, para);
      assertWritable({ text: next }, { force: this.force });
      this.#push({
        cell,
        nodeId: live.tapeIndex,
        ...para ? { para } : {},
        ...opts?.runs ? { runs: opts.runs } : {},
        text: next,
        type: "innerText"
      });
      target.text = next;
      delete target.markup;
      delete target.chips;
      delete target.fontColors;
      delete target.footnoteIds;
      syncCellHead(live, cell);
      return;
    }
    if (live.kind !== "paragraph") {
      throw new Error('innerText is only supported on paragraph nodes (use at: "h.arch.table.0.1.3c8f" from query --full for tables)');
    }
    assertWritable({ bullet: live.bullet, namedStyleType: live.namedStyleType, text: next }, { force: this.force });
    const pending = this.#pendingSpec(live.tapeIndex);
    if (pending?.kind === "paragraph") {
      pending.text = next;
      if (opts?.runs)
        pending.runs = opts.runs;
      live.text = next;
      delete live.markup;
      delete live.chips;
      delete live.fontColors;
      delete live.footnoteIds;
      return;
    }
    this.#push({
      nodeId: live.tapeIndex,
      ...opts?.runs ? { runs: opts.runs } : {},
      text: next,
      type: "innerText"
    });
    live.text = next;
    delete live.markup;
    delete live.chips;
    delete live.fontColors;
    delete live.footnoteIds;
  }
  setNamedStyleType(node, namedStyleType) {
    const live = this.#find(node.tapeIndex);
    if (!live)
      throw new Error(`Node ${node.tapeIndex} is not in the tape`);
    if (live.kind !== "paragraph") {
      throw new Error("namedStyleType is only supported on paragraph nodes");
    }
    const pending = this.#pendingSpec(live.tapeIndex);
    if (pending?.kind === "paragraph") {
      pending.namedStyleType = namedStyleType;
      live.namedStyleType = namedStyleType;
      return;
    }
    this.#push({
      namedStyleType,
      nodeId: live.tapeIndex,
      type: "namedStyleType"
    });
    live.namedStyleType = namedStyleType;
  }
  setStyle(node, patch, cell, para) {
    if (patch?.tableAlignment !== undefined) {
      throw new Error("tableAlignment is not supported: Google Docs tables default to full page width (left-aligned under the hood). Google Docs REST API has no property or request for table page alignment (center/left/right). Use fixed columnWidth to control column sizes (table remains left-aligned), or cellTextAlignment to align cell text.");
    }
    if (patch?.cellTextAlignment !== undefined && !patch.alignment) {
      patch.alignment = patch.cellTextAlignment;
    }
    if (!hasStyle(patch))
      return;
    const live = this.#find(node.tapeIndex);
    if (!live)
      throw new Error(`Node ${node.tapeIndex} is not in the tape`);
    if (cell) {
      const target = requireCellPara(live, cell, para);
      this.#push({
        cell,
        nodeId: live.tapeIndex,
        ...para ? { para } : {},
        patch,
        type: "style"
      });
      applyPatchToPara(target, patch);
      applyPatchToTable(live, patch);
      if (patch.cellBackground) {
        const tableCell = requireCell(live, cell);
        tableCell.backgroundColor = patch.cellBackground;
      }
      syncCellHead(live, cell);
      return;
    }
    if (patch.columnCount != null && live.kind !== "sectionBreak") {
      throw new Error("columnCount is only valid on a sectionBreak node");
    }
    if (live.kind === "table") {
      const disallowed = tableDisallowedKeys(patch);
      if (disallowed.length) {
        if (disallowed.includes("tableAlignment")) {
          throw new Error("tableAlignment is not supported: Google Docs REST API has no property or request for table page alignment (center/left/right). Use fixed columnWidth to control table width, or alignment to align cell text.");
        }
        throw new Error(`style on a table node only accepts alignment, cellBackground, columnWidth, borderColor, borderWidth, cellPadding, contentAlignment, minRowHeight (not ${disallowed.join(", ")}). Cell text uses at: "h.arch.table.0.1.3c8f".`);
      }
      this.#push({ nodeId: live.tapeIndex, patch, type: "style" });
      applyPatchToTable(live, patch);
      return;
    }
    if (hasTableChrome(patch)) {
      throw new Error("columnWidth, borders, cellPadding, contentAlignment, minRowHeight, and cellBackground require a table node or cell id");
    }
    if (live.kind !== "paragraph" && live.kind !== "sectionBreak" && patch.columnCount == null) {
      throw new Error('style is only supported on paragraph, table, or sectionBreak nodes (use at: "h.arch.table.0.1.3c8f" from query --full for cells)');
    }
    const pending = this.#pendingSpec(live.tapeIndex);
    if (pending?.kind === "paragraph") {
      pending.style = { ...pending.style, ...patch };
      if (patch.alignment)
        pending.alignment = patch.alignment;
      if (patch.indentStart != null) {
        pending.indentStart = { magnitude: patch.indentStart, unit: "PT" };
      }
      applyPatchToPara(live, patch);
      return;
    }
    this.#push({ nodeId: live.tapeIndex, patch, type: "style" });
    applyPatchToPara(live, patch);
    if (patch.columnCount != null)
      live.columnCount = patch.columnCount;
  }
  setAlignment(node, alignment, cell, para) {
    this.setStyle(node, { alignment }, cell, para);
  }
  setBulletPreset(node, preset) {
    const live = this.#find(node.tapeIndex);
    if (!live)
      throw new Error(`Node ${node.tapeIndex} is not in the tape`);
    if (live.kind !== "paragraph") {
      throw new Error("bullet restyle is only valid on a paragraph");
    }
    this.#push({ nodeId: live.tapeIndex, preset, type: "bullets" });
  }
  remove(node) {
    const live = this.#find(node.tapeIndex);
    if (!live)
      throw new Error(`Node ${node.tapeIndex} is not in the tape`);
    this.#push({ nodeId: live.tapeIndex, type: "remove" });
    this.#nodes.splice(this.#nodes.findIndex((n) => n.tapeIndex === live.tapeIndex), 1);
  }
  insertTableRow(tableNode, cell, insertBelow = true, cells) {
    const live = this.#find(tableNode.tapeIndex);
    if (!live)
      throw new Error(`Node ${tableNode.tapeIndex} is not in the tape`);
    if (live.kind !== "table") {
      throw new Error("insertTableRow is only valid on a table node");
    }
    this.#push({
      cell,
      ...cells ? { cells } : {},
      insertBelow,
      nodeId: live.tapeIndex,
      type: "insertTableRow"
    });
  }
  deleteTableRow(tableNode, cell) {
    const live = this.#find(tableNode.tapeIndex);
    if (!live)
      throw new Error(`Node ${tableNode.tapeIndex} is not in the tape`);
    if (live.kind !== "table") {
      throw new Error("deleteTableRow is only valid on a table node");
    }
    this.#push({
      cell,
      nodeId: live.tapeIndex,
      type: "deleteTableRow"
    });
  }
  insertTableColumn(tableNode, cell, insertRight = true) {
    const live = this.#find(tableNode.tapeIndex);
    if (!live)
      throw new Error(`Node ${tableNode.tapeIndex} is not in the tape`);
    if (live.kind !== "table") {
      throw new Error("insertTableColumn is only valid on a table node");
    }
    this.#push({
      cell,
      insertRight,
      nodeId: live.tapeIndex,
      type: "insertTableColumn"
    });
  }
  deleteTableColumn(tableNode, cell) {
    const live = this.#find(tableNode.tapeIndex);
    if (!live)
      throw new Error(`Node ${tableNode.tapeIndex} is not in the tape`);
    if (live.kind !== "table") {
      throw new Error("deleteTableColumn is only valid on a table node");
    }
    this.#push({
      cell,
      nodeId: live.tapeIndex,
      type: "deleteTableColumn"
    });
  }
  #push(mutation) {
    this.#mutations.push(this.#nextOpIndex != null ? { ...mutation, opIndex: this.#nextOpIndex } : mutation);
  }
  #find(tapeIndex) {
    return this.#nodes.find((n) => n.tapeIndex === tapeIndex);
  }
  #pendingSpec(tapeIndex) {
    for (const m2 of this.#mutations) {
      if (m2.type === "insertAdjacent" && m2.newId === tapeIndex)
        return m2.spec;
    }
    return;
  }
}

class DomHandle {
  writer;
  node;
  constructor(writer, node) {
    this.writer = writer;
    this.node = node;
  }
  get innerText() {
    return this.node.text ?? "";
  }
  set innerText(text) {
    this.writer.setInnerText(this.node, text);
  }
  set namedStyleType(namedStyleType) {
    this.writer.setNamedStyleType(this.node, namedStyleType);
  }
  set alignment(alignment) {
    this.writer.setAlignment(this.node, alignment);
  }
  insertAdjacentElement(position, element) {
    const created = this.writer.insertAdjacentElement(this.node, position, element);
    return new DomHandle(this.writer, created);
  }
  remove() {
    this.writer.remove(this.node);
  }
}
function clonePara(p) {
  return {
    ...p,
    ...p.chips ? { chips: p.chips.map((chip) => ({ ...chip })) } : {},
    ...p.images ? { images: p.images.map((img) => ({ ...img })) } : {}
  };
}
function cloneNode(node) {
  return {
    ...node,
    ...node.bullet ? { bullet: { ...node.bullet } } : {},
    ...node.footnoteIds ? { footnoteIds: [...node.footnoteIds] } : {},
    ...node.indentStart ? { indentStart: { ...node.indentStart } } : {},
    ...node.indentFirstLine ? { indentFirstLine: { ...node.indentFirstLine } } : {},
    ...node.indentEnd ? { indentEnd: { ...node.indentEnd } } : {},
    ...node.table ? {
      table: {
        ...node.table.columnWidth != null ? { columnWidth: node.table.columnWidth } : {},
        ...node.table.borderColor ? { borderColor: node.table.borderColor } : {},
        ...node.table.cellPadding != null ? { cellPadding: node.table.cellPadding } : {},
        ...node.table.contentAlignment ? { contentAlignment: node.table.contentAlignment } : {},
        ...node.table.minRowHeight != null ? { minRowHeight: node.table.minRowHeight } : {},
        cells: node.table.cells.map((row) => row.map((cell) => ({
          ...clonePara(cell),
          paragraphs: (cell.paragraphs ?? [cell]).map(clonePara),
          ...cell.backgroundColor ? { backgroundColor: cell.backgroundColor } : {}
        })))
      }
    } : {},
    ...node.images ? { images: node.images.map((img) => ({ ...img })) } : {},
    ...node.chips ? { chips: node.chips.map((chip) => ({ ...chip })) } : {}
  };
}
function specToNode(spec, tapeIndex) {
  if (spec.kind === "table") {
    return {
      end: -1,
      tapeIndex,
      kind: "table",
      start: -1,
      table: {
        cells: spec.table.rows.map((row, r) => row.map((text, c) => {
          const parsed2 = chipsImagesFromSpecials(spec.table.cellSpecials?.[r]?.[c]);
          const p = { end: -1, start: -1, text, ...parsed2 };
          return { ...p, paragraphs: [p] };
        }))
      }
    };
  }
  if (spec.kind === "pageBreak") {
    return { end: -1, tapeIndex, kind: "pageBreak", start: -1 };
  }
  if (spec.kind === "sectionBreak") {
    return { end: -1, tapeIndex, kind: "sectionBreak", start: -1 };
  }
  if (spec.kind === "person") {
    return {
      chips: [
        {
          email: spec.email,
          end: -1,
          kind: "person",
          start: -1,
          textOffset: 0,
          title: spec.email,
          uri: `mailto:${spec.email}`
        }
      ],
      end: -1,
      tapeIndex,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: -1,
      text: `@${spec.email}`
    };
  }
  if (spec.kind === "richLink") {
    return {
      chips: [
        {
          end: -1,
          kind: "richLink",
          start: -1,
          textOffset: 0,
          title: spec.title ?? spec.uri,
          uri: spec.uri,
          ...spec.mimeType ? { mimeType: spec.mimeType } : {}
        }
      ],
      end: -1,
      tapeIndex,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: -1,
      text: spec.title ?? spec.uri
    };
  }
  if (spec.kind === "date") {
    return {
      chips: [
        {
          end: -1,
          kind: "date",
          start: -1,
          textOffset: 0,
          title: spec.displayText ?? spec.timestamp ?? "date",
          uri: "",
          ...spec.dateFormat ? { dateFormat: spec.dateFormat } : {},
          ...spec.timestamp ? { timestamp: spec.timestamp } : {}
        }
      ],
      end: -1,
      tapeIndex,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: -1,
      text: spec.displayText ?? spec.timestamp ?? ""
    };
  }
  if (spec.kind === "footnote") {
    return {
      end: -1,
      footnoteIds: [""],
      tapeIndex,
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: -1,
      text: spec.text ?? "[^]"
    };
  }
  if (spec.kind === "inlineImage") {
    return {
      end: -1,
      tapeIndex,
      images: [
        {
          end: -1,
          objectId: "",
          start: -1,
          sourceUri: spec.uri,
          textOffset: 0,
          ...spec.heightPt != null ? { heightPt: spec.heightPt } : {},
          ...spec.widthPt != null ? { widthPt: spec.widthPt } : {}
        }
      ],
      kind: "paragraph",
      namedStyleType: "NORMAL_TEXT",
      start: -1,
      text: ""
    };
  }
  const node = {
    ...spec.alignment ? { alignment: spec.alignment } : {},
    ...spec.bullet ? { bullet: { nestingLevel: spec.bullet.nestingLevel } } : {},
    ...spec.indentStart ? { indentStart: spec.indentStart } : {},
    end: -1,
    tapeIndex,
    kind: "paragraph",
    namedStyleType: spec.namedStyleType,
    start: -1,
    text: spec.text
  };
  const parsed = chipsImagesFromSpecials(spec.specials);
  if (parsed.chips)
    node.chips = parsed.chips;
  if (parsed.images)
    node.images = parsed.images;
  if (spec.style) {
    applyPatchToPara(node, spec.style);
    if (spec.style.foregroundColor || spec.style.fontSize || spec.style.italic) {
      node.style = {
        ...spec.style.fontSize ? { fontSize: spec.style.fontSize } : {},
        ...spec.style.foregroundColor ? { foregroundColor: spec.style.foregroundColor } : {},
        ...spec.style.italic ? { italic: spec.style.italic } : {}
      };
    }
    if (spec.style.foregroundColor) {
      node.fontColors = [spec.style.foregroundColor.toUpperCase()];
    }
  }
  if (spec.runs?.length) {
    const runColors = spec.runs.map((r) => r.foregroundColor).filter((c) => Boolean(c)).map((c) => c.toUpperCase());
    if (runColors.length > 0) {
      node.fontColors = Array.from(new Set([...node.fontColors ?? [], ...runColors]));
    }
  }
  return node;
}
function chipsImagesFromSpecials(specials) {
  if (!specials?.length)
    return {};
  const chips = [];
  const images = [];
  for (const special of specials) {
    if (special.kind === "person") {
      chips.push({
        email: special.email,
        end: -1,
        kind: "person",
        start: -1,
        textOffset: special.offset,
        title: special.email,
        uri: `mailto:${special.email}`
      });
    } else if (special.kind === "date") {
      const chip = {
        end: -1,
        kind: "date",
        start: -1,
        textOffset: special.offset,
        title: special.displayText ?? special.timestamp,
        uri: ""
      };
      if (special.dateFormat)
        chip.dateFormat = special.dateFormat;
      chip.timestamp = special.timestamp;
      chips.push(chip);
    } else if (special.kind === "richLink") {
      const chip = {
        end: -1,
        kind: "richLink",
        start: -1,
        textOffset: special.offset,
        title: special.title ?? special.uri,
        uri: special.uri
      };
      if (special.mimeType)
        chip.mimeType = special.mimeType;
      chips.push(chip);
    } else {
      const image = {
        end: -1,
        objectId: "",
        start: -1,
        sourceUri: special.uri,
        textOffset: special.offset
      };
      if (special.heightPt != null)
        image.heightPt = special.heightPt;
      if (special.widthPt != null)
        image.widthPt = special.widthPt;
      images.push(image);
    }
  }
  return {
    ...chips.length ? { chips } : {},
    ...images.length ? { images } : {}
  };
}
function requireCell(node, cell) {
  if (node.kind !== "table" || !node.table) {
    throw new Error("cell id is only valid on a table node");
  }
  const [r, c] = cell;
  const hit = node.table.cells[r]?.[c];
  if (!hit) {
    throw new Error(`No cell [${r}, ${c}] — table is ${node.table.cells.length}×${node.table.cells[0]?.length ?? 0}`);
  }
  if (!hit.paragraphs?.length) {
    hit.paragraphs = [{ end: hit.end, start: hit.start, text: hit.text }];
  }
  return hit;
}
function requireCellPara(node, cell, para) {
  const tableCell = requireCell(node, cell);
  const i = para ?? 0;
  const hit = tableCell.paragraphs[i];
  if (!hit) {
    throw new Error(`No paragraph ${i} in cell [${cell[0]}, ${cell[1]}] (${tableCell.paragraphs.length} paragraphs)`);
  }
  return hit;
}
function syncCellHead(node, cell) {
  const tableCell = requireCell(node, cell);
  const head = tableCell.paragraphs[0];
  if (!head)
    return;
  tableCell.alignment = head.alignment;
  tableCell.end = head.end;
  tableCell.images = head.images;
  tableCell.markup = head.markup;
  tableCell.start = head.start;
  tableCell.text = head.text;
}
function tableDisallowedKeys(patch) {
  const allowed = new Set([
    "alignment",
    "borderColor",
    "borderWidth",
    "cellBackground",
    "cellPadding",
    "cellTextAlignment",
    "columnWidth",
    "contentAlignment",
    "minRowHeight",
    "pinnedHeaderRows",
    "preventOverflow"
  ]);
  return Object.keys(patch).filter((k) => patch[k] !== undefined && !allowed.has(k));
}
function applyPatchToTable(node, patch) {
  if (!node.table)
    return;
  if (patch.columnWidth != null)
    node.table.columnWidth = patch.columnWidth;
  if (patch.borderColor)
    node.table.borderColor = patch.borderColor;
  if (patch.cellPadding != null)
    node.table.cellPadding = patch.cellPadding;
  if (patch.contentAlignment)
    node.table.contentAlignment = patch.contentAlignment;
  if (patch.minRowHeight != null)
    node.table.minRowHeight = patch.minRowHeight;
  if (patch.pinnedHeaderRows != null)
    node.table.pinnedHeaderRows = patch.pinnedHeaderRows;
  if (patch.preventOverflow != null)
    node.table.preventOverflow = patch.preventOverflow;
}
function applyPatchToPara(target, patch) {
  if (patch.alignment)
    target.alignment = patch.alignment;
  if (patch.lineSpacing != null)
    target.lineSpacing = patch.lineSpacing;
  if (patch.shading)
    target.shading = patch.shading;
  if (patch.spaceAbove != null)
    target.spaceAbove = patch.spaceAbove;
  if (patch.spaceBelow != null)
    target.spaceBelow = patch.spaceBelow;
  if (patch.indentStart != null) {
    target.indentStart = { magnitude: patch.indentStart, unit: "PT" };
  }
  if (patch.indentFirstLine != null) {
    target.indentFirstLine = { magnitude: patch.indentFirstLine, unit: "PT" };
  }
  if (patch.indentEnd != null) {
    target.indentEnd = { magnitude: patch.indentEnd, unit: "PT" };
  }
}

// src/core/actions/flush.ts
var RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000, 60000];
async function pendingWritersFlush(runtime, docRef) {
  const docsToFlush = [];
  if (docRef) {
    const doc = runtime.openDocResolve(docRef);
    if (doc)
      docsToFlush.push(doc);
  } else {
    docsToFlush.push(...runtime.openDocs.values());
  }
  for (const docCtx of docsToFlush) {
    if (!docCtx.pendingWriters || docCtx.pendingWriters.size === 0)
      continue;
    if (runtime.dryRun || docCtx.docId.startsWith("virtual:")) {
      docCtx.pendingWriters.clear();
      continue;
    }
    const entries = Array.from(docCtx.pendingWriters.values());
    const writersWithMutations = entries.map((e) => e.writer).filter((w) => w.mutations().length > 0);
    if (writersWithMutations.length > 0) {
      const allPlans = entries.flatMap((e) => e.plans);
      try {
        await applyDom(docCtx.docId, writersWithMutations, {
          client: runtime.client,
          doc: docCtx.gdoc.data,
          dryRun: false,
          force: runtime.force,
          plan: allPlans
        });
        docCtx.gdoc = await Gdoc.load(docCtx.docId, runtime.client, { forceFetch: true });
      } catch (err) {
        if (!isRevisionMismatchError(err)) {
          throw err;
        }
        await replayPendingMutations(runtime, docCtx, RETRY_DELAYS_MS);
      }
    }
    docCtx.pendingWriters.clear();
  }
}
async function replayPendingMutations(runtime, docCtx, delays) {
  docCache.invalidate(docCtx.docId);
  for (let attempt = 0;attempt < delays.length; attempt++) {
    await sleep2(delays[attempt]);
    docCtx.gdoc = await Gdoc.load(docCtx.docId, runtime.client, { forceFetch: true });
    if (!docCtx.pendingWriters)
      break;
    for (const [tabKey, entry] of docCtx.pendingWriters.entries()) {
      const tabId = tabKey === "default" ? undefined : tabKey;
      const gdoc = tabId ? docCtx.gdoc.withTab(tabId) : docCtx.gdoc;
      const parsed = parseDocument(gdoc);
      const writer = new DomWriter(parsed.nodes, {
        doc: docCtx.gdoc.data,
        force: runtime.force,
        lists: gdoc.data.lists,
        tabId
      });
      entry.afterendTails = new Map;
      entry.doc = gdoc.data;
      entry.namedAnchors = new Map;
      entry.plans = [];
      entry.rootAnchors = new Map;
      entry.writer = writer;
      for (const item of entry.steps) {
        const op = item.op;
        const plans = tapeMutationsApply(entry.writer, [op], entry.writer.mutations().length, {
          afterendTails: entry.afterendTails,
          force: runtime.force || Boolean(op.force),
          namedAnchors: entry.namedAnchors,
          rootAnchors: entry.rootAnchors
        });
        if (plans?.length) {
          entry.plans.push(...plans);
        }
        assignScopedIds(entry.writer.nodes);
        const stepAs = item.step?.as;
        if (stepAs) {
          const namedNode = entry.namedAnchors.get(stepAs);
          if (namedNode?.scopedId) {
            runtime.aliasMap.set(stepAs, namedNode.scopedId);
          }
        }
      }
    }
    const entries = Array.from(docCtx.pendingWriters.values());
    const writersWithMutations = entries.map((e) => e.writer).filter((w) => w.mutations().length > 0);
    const allPlans = entries.flatMap((e) => e.plans);
    try {
      await applyDom(docCtx.docId, writersWithMutations, {
        client: runtime.client,
        doc: docCtx.gdoc.data,
        dryRun: false,
        force: runtime.force,
        plan: allPlans
      });
      docCtx.gdoc = await Gdoc.load(docCtx.docId, runtime.client, { forceFetch: true });
      return;
    } catch (retryErr) {
      if (!isRevisionMismatchError(retryErr)) {
        throw retryErr;
      }
      docCache.invalidate(docCtx.docId);
    }
  }
  throw new Error(`Document "${docCtx.docId}" was modified externally and remained busy after retry attempts.`);
}
function sleep2(ms) {
  return new Promise((resolve5) => setTimeout(resolve5, ms));
}

// src/core/actions/close.ts
var closeStep = async (runtime, _stepIndex, step) => {
  if (step.doc) {
    await pendingWritersFlush(runtime, step.doc);
  }
  const targetDoc = runtime.openDocResolve(step.doc);
  runtime.openDocs.delete(targetDoc.alias);
  runtime.docIdToAlias.delete(targetDoc.docId);
  runtime.aliasMap.delete(targetDoc.alias);
  if (runtime.activeDocAlias === targetDoc.alias) {
    runtime.activeDocAlias = runtime.openDocs.keys().next().value;
  }
  runtime.stepsExecuted++;
};

// src/core/dom/export.ts
function docNodesAudit(nodes, opts = {}) {
  const issues = [];
  let styledCount = 0;
  const stylesMap = {};
  for (const node of nodes) {
    if (!node.isCode && node.style && Object.keys(node.style).length > 0) {
      styledCount++;
      stylesMap[String(node.tapeIndex)] = node.style;
    }
    if (node.images?.length) {
      issues.push(`Node ${node.tapeIndex}: ${node.images.length} image(s) replaced with [Image] placeholder`);
    }
    if (node.chips?.length) {
      issues.push(`Node ${node.tapeIndex}: ${node.chips.length} smart chip(s) flattened to text/links`);
    }
    if (node.footnoteIds?.length) {
      issues.push(`Node ${node.tapeIndex}: ${node.footnoteIds.length} footnote(s) omitted`);
    }
    if (node.hasEquation) {
      issues.push(`Node ${node.tapeIndex}: Math equation omitted (REST API cannot insert equations)`);
    }
    if (node.hasHorizontalRule) {
      issues.push(`Node ${node.tapeIndex}: Horizontal rule / divider omitted`);
    }
    if (node.kind === "tableOfContents") {
      issues.push(`Node ${node.tapeIndex}: Table of Contents block omitted (REST API cannot create TOC)`);
    }
    if (node.kind === "sectionBreak") {
      issues.push(`Node ${node.tapeIndex}: Section break / page setup omitted (cannot be cloned detachedly)`);
    }
    if (node.kind === "table" && node.table) {
      for (const row of node.table.cells) {
        for (const cell of row) {
          if (cell.images?.length) {
            issues.push(`Node ${node.tapeIndex} table cell: ${cell.images.length} image(s) replaced with [Image] placeholder`);
          }
          if (cell.chips?.length) {
            issues.push(`Node ${node.tapeIndex} table cell: ${cell.chips.length} smart chip(s) flattened`);
          }
        }
      }
    }
  }
  const summary = {
    documentId: opts.documentId,
    issues,
    lossless: issues.length === 0,
    nodeCount: nodes.length,
    styledNodesCount: styledCount,
    tabId: opts.tabId,
    tabTitle: opts.tabTitle
  };
  if (opts.includeStyles && styledCount > 0) {
    summary.styles = stylesMap;
  }
  return summary;
}
function documentExportToMarkdown(tabs, opts = {}) {
  if (tabs.length === 0) {
    return {
      audit: {
        documentId: opts.documentId,
        issues: [],
        lossless: true,
        nodeCount: 0,
        styledNodesCount: 0
      },
      markdown: ""
    };
  }
  if (tabs.length === 1) {
    const single = tabs[0];
    const audit2 = docNodesAudit(single.nodes, {
      documentId: opts.documentId,
      includeStyles: opts.includeStyles,
      tabId: single.tabId,
      tabTitle: single.tabTitle
    });
    const bodyLines = nodesRenderToMarkdown(single.nodes);
    return {
      audit: audit2,
      markdown: `${bodyLines.join(`

`)}
`
    };
  }
  const tabAudits = [];
  const aggregatedIssues = [];
  let totalNodeCount = 0;
  let totalStyledCount = 0;
  const mergedStyles = {};
  for (let i = 0;i < tabs.length; i++) {
    const t = tabs[i];
    const tabAudit = docNodesAudit(t.nodes, {
      documentId: opts.documentId,
      includeStyles: opts.includeStyles,
      tabId: t.tabId,
      tabTitle: t.tabTitle
    });
    tabAudits.push(tabAudit);
    totalNodeCount += tabAudit.nodeCount;
    totalStyledCount += tabAudit.styledNodesCount;
    if (tabAudit.styles) {
      Object.assign(mergedStyles, tabAudit.styles);
    }
    const tabLabel = t.tabTitle || t.tabId || `Tab ${i + 1}`;
    for (const issue of tabAudit.issues) {
      aggregatedIssues.push(`[${tabLabel}] ${issue}`);
    }
  }
  const tabBodies = [];
  for (const t of tabs) {
    const bodyLines = nodesRenderToMarkdown(t.nodes);
    const firstMeaningful = t.nodes.find((n) => n.kind === "paragraph" && (n.text?.trim() || n.markup?.trim()));
    const firstText = (firstMeaningful?.text ?? "").trim().toLowerCase();
    const titleText = (t.tabTitle ?? "").trim().toLowerCase();
    const hasMatchingTitle = firstMeaningful && (firstMeaningful.namedStyleType === "TITLE" || firstMeaningful.namedStyleType === "HEADING_1") && firstText === titleText;
    let content = bodyLines.join(`

`);
    if (!hasMatchingTitle && t.tabTitle?.trim()) {
      content = `# ${t.tabTitle.trim()}${content ? `

${content}` : ""}`;
    }
    tabBodies.push(content);
  }
  const audit = {
    documentId: opts.documentId,
    issues: aggregatedIssues,
    lossless: aggregatedIssues.length === 0,
    nodeCount: totalNodeCount,
    styledNodesCount: totalStyledCount,
    tabCount: tabs.length,
    tabs: tabs.map((t, idx) => ({
      issues: tabAudits[idx]?.issues ?? [],
      lossless: tabAudits[idx]?.lossless ?? true,
      nodeCount: tabAudits[idx]?.nodeCount ?? 0,
      tabId: t.tabId ?? "",
      tabTitle: t.tabTitle ?? ""
    }))
  };
  if (opts.includeStyles && totalStyledCount > 0) {
    audit.styles = mergedStyles;
  }
  return {
    audit,
    markdown: `${tabBodies.join(`

---

`)}
`
  };
}
var exportDocumentToMarkdown = documentExportToMarkdown;
function bridgingEmptyLineCountGet(nodes, fromIndex, maxEmpty = 2) {
  let count = 0;
  for (let k = fromIndex;k < nodes.length; k++) {
    const candidate = nodes[k];
    if (candidate.kind === "paragraph" && !candidate.text?.trim() && !candidate.images?.length && !candidate.chips?.length && !candidate.bullet) {
      count++;
      if (count > maxEmpty)
        return 0;
    } else if (candidate.isCode) {
      return count;
    } else {
      return 0;
    }
  }
  return 0;
}
function codeFenceGet(lines) {
  let maxTicks = 0;
  for (const line of lines) {
    const matches = line.match(/`+/g);
    if (matches) {
      for (const m2 of matches) {
        if (m2.length > maxTicks) {
          maxTicks = m2.length;
        }
      }
    }
  }
  return "`".repeat(Math.max(3, maxTicks + 1));
}
function nodesRenderToMarkdown(nodes) {
  const bodyLines = [];
  for (let i = 0;i < nodes.length; i++) {
    const node = nodes[i];
    if (node.kind === "sectionBreak") {
      continue;
    }
    if (node.kind === "pageBreak") {
      bodyLines.push("---");
      continue;
    }
    if (node.kind === "table" && node.table) {
      bodyLines.push(tableToMarkdown(node.table.cells));
      continue;
    }
    if (node.kind === "paragraph") {
      if (node.isCode) {
        const codeLines = [node.text ?? ""];
        let j = i + 1;
        while (j < nodes.length) {
          const next = nodes[j];
          if (next.isCode) {
            codeLines.push(next.text ?? "");
            j++;
          } else if (next.kind === "paragraph" && !next.text?.trim() && !next.images?.length && !next.chips?.length && !next.bullet) {
            const bridgeCount = bridgingEmptyLineCountGet(nodes, j);
            if (bridgeCount > 0) {
              for (let b2 = 0;b2 < bridgeCount; b2++) {
                codeLines.push(nodes[j + b2]?.text ?? "");
              }
              j += bridgeCount;
            } else {
              break;
            }
          } else {
            break;
          }
        }
        i = j - 1;
        const fence = codeFenceGet(codeLines);
        const bqPrefix = node.indentStart?.magnitude && node.indentStart.magnitude >= 18 ? "> ".repeat(Math.round(node.indentStart.magnitude / 18)) : "";
        const blockContent = [fence, ...codeLines, fence];
        bodyLines.push(blockContent.map((line) => bqPrefix ? `${bqPrefix}${line}` : line).join(`
`));
        continue;
      }
      let rawText = node.markup ?? node.text ?? "";
      if (node.images?.length && !rawText.includes("[Image]")) {
        rawText = rawText.trim() ? `${rawText} [Image]` : "[Image]";
      }
      const named = node.namedStyleType ?? "NORMAL_TEXT";
      if (named === "TITLE" || named === "HEADING_1") {
        bodyLines.push(`# ${rawText}`);
      } else if (named === "SUBTITLE" || named === "HEADING_2") {
        bodyLines.push(`## ${rawText}`);
      } else if (named === "HEADING_3") {
        bodyLines.push(`### ${rawText}`);
      } else if (named === "HEADING_4") {
        bodyLines.push(`#### ${rawText}`);
      } else if (named === "HEADING_5") {
        bodyLines.push(`##### ${rawText}`);
      } else if (named === "HEADING_6") {
        bodyLines.push(`###### ${rawText}`);
      } else if (node.bullet) {
        const listCounters = new Map;
        const listLines = [];
        let j = i;
        while (j < nodes.length) {
          const itemNode = nodes[j];
          if (itemNode.kind !== "paragraph" || !itemNode.bullet) {
            break;
          }
          let rawItemText = itemNode.markup ?? itemNode.text ?? "";
          if (itemNode.images?.length && !rawItemText.includes("[Image]")) {
            rawItemText = rawItemText.trim() ? `${rawItemText} [Image]` : "[Image]";
          }
          const level = itemNode.bullet.nestingLevel ?? 0;
          const indent = "  ".repeat(level);
          const isCheckbox = itemNode.bullet.type === "CHECKBOX" || itemNode.bullet.preset === "BULLET_CHECKBOX";
          const isNumbered = itemNode.bullet.type === "NUMBERED" || Boolean(itemNode.bullet.preset?.startsWith("NUMBERED"));
          for (const key of Array.from(listCounters.keys())) {
            if (key > level) {
              listCounters.delete(key);
            }
          }
          if (isCheckbox) {
            listCounters.delete(level);
            listLines.push(`${indent}- [ ] ${rawItemText}`);
          } else if (isNumbered) {
            const nextCount = (listCounters.get(level) ?? 0) + 1;
            listCounters.set(level, nextCount);
            listLines.push(`${indent}${nextCount}. ${rawItemText}`);
          } else {
            listCounters.delete(level);
            listLines.push(`${indent}- ${rawItemText}`);
          }
          j++;
        }
        i = j - 1;
        bodyLines.push(listLines.join(`
`));
      } else {
        bodyLines.push(rawText);
      }
    }
  }
  return bodyLines;
}
function tableToMarkdown(cells) {
  if (!cells.length)
    return "";
  const lines = [];
  const colCount = Math.max(...cells.map((r) => r.length));
  for (let r = 0;r < cells.length; r++) {
    const row = cells[r];
    const rowContent = Array.from({ length: colCount }, (_2, c) => {
      const cell = row[c];
      if (!cell)
        return "";
      const text = (cell.paragraphs && cell.paragraphs.length > 0 ? cell.paragraphs : [cell]).map((p) => p.markup ?? p.text ?? "").join(" ").replace(/\|/g, "\\|").replace(/\n+/g, " ");
      return text;
    });
    lines.push(`| ${rowContent.join(" | ")} |`);
    if (r === 0) {
      const divider = Array.from({ length: colCount }, () => "---");
      lines.push(`| ${divider.join(" | ")} |`);
    }
  }
  return lines.join(`
`);
}

// src/core/actions/simulated.ts
function simulatedNodesOf(gdoc, tabId) {
  const sim = gdoc;
  if (sim.simulatedTabs && tabId)
    return sim.simulatedTabs.get(tabId);
  return sim.simulatedNodes;
}
function simulatedNodesSet(gdoc, nodes, tabId) {
  const sim = gdoc;
  sim.simulatedNodes = nodes;
  if (tabId) {
    if (!sim.simulatedTabs)
      sim.simulatedTabs = new Map;
    sim.simulatedTabs.set(tabId, nodes);
  }
}

// src/core/actions/docCreate.ts
var docCreateStep = async (runtime, stepIndex, step) => {
  const as = step.as;
  if (!as)
    throw new Error(`steps[${stepIndex}] docCreate requires "as: <alias>"`);
  const title = step.title;
  if (!title)
    throw new Error(`steps[${stepIndex}] docCreate requires title: <string>`);
  const fromDocRaw = step.fromDoc;
  if (fromDocRaw) {
    const fromDoc = runtime.aliasResolve(fromDocRaw);
    if (!fromDoc)
      throw new Error(`steps[${stepIndex}] docCreate could not resolve fromDoc: "${fromDocRaw}"`);
    let newDocId2 = `virtual:${as}`;
    let gdoc2;
    if (runtime.dryRun) {
      const sourceContext = runtime.openDocs.get(fromDoc) ?? Array.from(runtime.openDocs.values()).find((d2) => d2.docId === fromDoc);
      if (sourceContext) {
        gdoc2 = new Gdoc({ ...structuredClone(sourceContext.gdoc.data), documentId: newDocId2, title }, newDocId2);
        const sourceSim = sourceContext.gdoc;
        if (sourceSim.simulatedNodes) {
          simulatedNodesSet(gdoc2, structuredClone(sourceSim.simulatedNodes));
        }
        if (sourceSim.simulatedTabs) {
          for (const [tId, nodes] of sourceSim.simulatedTabs.entries()) {
            simulatedNodesSet(gdoc2, structuredClone(nodes), tId);
          }
        }
      } else {
        try {
          const loaded = runtime.preloadedDocs?.get(fromDoc) ?? await Gdoc.load(fromDoc, runtime.client);
          gdoc2 = new Gdoc({ ...structuredClone(loaded.data), documentId: newDocId2, title }, newDocId2);
        } catch {
          gdoc2 = new Gdoc({ documentId: newDocId2, title }, newDocId2);
        }
      }
    } else {
      const res = await gwsDrive.copyFile(fromDoc, title);
      newDocId2 = res.id;
      gdoc2 = await Gdoc.load(newDocId2, runtime.client);
    }
    const openContext2 = {
      alias: as,
      docId: newDocId2,
      gdoc: gdoc2,
      isVirtual: runtime.dryRun,
      title
    };
    const tabs = flattenTabs(gdoc2.data.tabs);
    const tabsToCheck = tabs.length > 0 ? tabs : [{ tabId: "t.0", title }];
    const dumpPayload2 = {
      alias: as,
      id: newDocId2,
      kind: "doc",
      tabs: tabsToCheck.map((t) => ({ id: t.tabId, kind: "tab", title: t.title })),
      title
    };
    runtime.openDocs.set(as, openContext2);
    runtime.docIdToAlias.set(newDocId2, as);
    runtime.aliasMap.set(as, newDocId2);
    runtime.dumpStore.set(as, dumpPayload2);
    if (step.dump) {
      runtime.dumped[as] = dumpPayload2;
    }
    runtime.activeDocAlias = as;
    if (runtime.dryRun) {
      for (const t of tabsToCheck) {
        const parsed = parseDocument(t.tabId && gdoc2.data.tabs?.length ? gdoc2.withTab(t.tabId) : gdoc2);
        const exp = exportDocumentToMarkdown([{ nodes: parsed.nodes, tabId: t.tabId, tabTitle: t.title }]);
        runtime.initialMarkdownStates.set(`${as}/${t.tabId}`, exp.markdown);
      }
    }
    runtime.stepsExecuted++;
    return;
  }
  const mode = step.mode ?? step.pageSetup?.mode ?? (step.pageless !== undefined ? step.pageless ? "PAGELESS" : "PAGES" : step.pageSetup?.pageless !== undefined ? step.pageSetup.pageless ? "PAGELESS" : "PAGES" : undefined);
  const effectivePageSetup = step.pageSetup || mode ? {
    ...step.pageSetup ?? {},
    ...mode ? { mode, pageless: mode === "PAGELESS" } : {}
  } : undefined;
  let newDocId = `virtual:${as}`;
  if (!runtime.dryRun) {
    const createDoc = runtime.client.createDocument?.bind(runtime.client) ?? gws.createDocument.bind(gws);
    const res = await createDoc(title);
    newDocId = res.documentId;
    if (effectivePageSetup) {
      const styleReq = buildDocumentStyleRequest(effectivePageSetup);
      if ("updateDocumentStyle" in styleReq) {
        await runtime.client.batchUpdate(newDocId, [styleReq]);
      }
    }
  }
  const initialBody = {
    content: [
      { endIndex: 1, sectionBreak: {}, startIndex: 0 },
      {
        endIndex: 2,
        paragraph: { elements: [{ textRun: { content: `
` } }] },
        startIndex: 1
      }
    ]
  };
  const initialDocumentStyle = effectivePageSetup?.mode ? { documentFormat: { documentMode: effectivePageSetup.mode } } : undefined;
  const gdoc = new Gdoc({
    body: initialBody,
    documentId: newDocId,
    documentStyle: initialDocumentStyle,
    tabs: [
      {
        documentTab: {
          body: initialBody,
          documentStyle: initialDocumentStyle
        },
        tabProperties: { tabId: "t.0", title: "Main" }
      }
    ],
    title
  }, newDocId);
  const openContext = {
    alias: as,
    docId: newDocId,
    gdoc,
    isVirtual: runtime.dryRun,
    title
  };
  const dumpPayload = {
    alias: as,
    id: newDocId,
    kind: "doc",
    tabs: [{ id: "t.0", kind: "tab", title: "Main" }],
    title
  };
  runtime.openDocs.set(as, openContext);
  runtime.docIdToAlias.set(newDocId, as);
  runtime.aliasMap.set(as, newDocId);
  runtime.dumpStore.set(as, dumpPayload);
  if (step.dump) {
    runtime.dumped[as] = dumpPayload;
  }
  runtime.activeDocAlias = as;
  if (runtime.dryRun) {
    runtime.initialMarkdownStates.set(`${as}/t.0`, "");
  }
  runtime.stepsExecuted++;
};

// src/core/actions/docDelete.ts
var docDeleteStep = async (runtime, _stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  if (!runtime.dryRun) {
    if (step.permanent) {
      await gwsDrive.deleteFile(targetDoc.docId);
    } else {
      await gwsDrive.updateFile(targetDoc.docId, { trashed: true });
    }
    docCache.invalidate(targetDoc.docId);
  }
  runtime.openDocs.delete(targetDoc.alias);
  runtime.stepsExecuted++;
};

// src/core/actions/docPermissionAdd.ts
var docPermissionAddStep = async (runtime, stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const email = step.email;
  let domain = step.domain;
  const rawScope = step.scope;
  const scope = rawScope === "internal" ? "domain" : rawScope ?? (email ? "user" : domain ? "domain" : "anyone");
  const role = step.role ?? "reader";
  if ((scope === "user" || scope === "group") && !email) {
    throw new Error(`steps[${stepIndex}] docPermissionAdd requires email when scope is "${scope}"`);
  }
  if (scope === "domain" && !domain) {
    if (runtime.dryRun || targetDoc.isVirtual) {
      domain = "example.com";
    } else {
      domain = await gwsDrive.userDomainGet();
    }
  }
  if (step.transferOwnership && role !== "owner") {
    throw new Error(`steps[${stepIndex}] docPermissionAdd requires role: "owner" when transferOwnership is true`);
  }
  let permission;
  if (runtime.dryRun || targetDoc.isVirtual) {
    permission = {
      displayName: email ?? domain ?? "Anyone with link",
      domain,
      emailAddress: email,
      id: `simulated:perm:${stepIndex}`,
      role,
      type: scope
    };
    if (!targetDoc.permissions) {
      targetDoc.permissions = [
        {
          displayName: "Document Owner",
          id: "simulated:owner",
          role: "owner",
          type: "user"
        }
      ];
    }
    targetDoc.permissions.push(permission);
  } else {
    permission = await gwsDrive.createPermission(targetDoc.docId, {
      domain,
      emailAddress: email,
      role,
      type: scope
    }, {
      emailMessage: step.emailMessage,
      moveToNewOwnersRoot: step.moveToNewOwnersRoot,
      sendNotificationEmail: step.sendNotificationEmail,
      transferOwnership: step.transferOwnership
    });
  }
  if (step.as) {
    runtime.dumped[step.as] = permission;
    runtime.dumpStore.set(step.as, permission);
  }
  runtime.stepsExecuted++;
};

// src/core/actions/docPermissionList.ts
var docPermissionListStep = async (runtime, _stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const as = step.as ?? `${targetDoc.alias}Permissions`;
  let permissions;
  if (runtime.dryRun || targetDoc.isVirtual) {
    if (!targetDoc.permissions) {
      targetDoc.permissions = [
        {
          displayName: "Document Owner",
          id: "simulated:owner",
          role: "owner",
          type: "user"
        }
      ];
    }
    permissions = [...targetDoc.permissions];
  } else {
    permissions = await gwsDrive.listPermissions(targetDoc.docId);
  }
  runtime.dumped[as] = permissions;
  runtime.dumpStore.set(as, permissions);
  runtime.stepsExecuted++;
};

// src/core/actions/docPermissionRemove.ts
var docPermissionRemoveStep = async (runtime, stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const permissionId = step.permissionId;
  const email = step.email;
  const domain = step.domain;
  const rawScope = step.scope;
  const scope = rawScope === "internal" ? "domain" : rawScope;
  if (!permissionId && !email && !domain && scope !== "anyone" && scope !== "domain") {
    throw new Error(`steps[${stepIndex}] docPermissionRemove requires permissionId, email, domain, or scope ("anyone" | "domain" | "internal")`);
  }
  if (runtime.dryRun || targetDoc.isVirtual) {
    if (targetDoc.permissions) {
      targetDoc.permissions = targetDoc.permissions.filter((p) => {
        if (permissionId && p.id === permissionId)
          return false;
        if (email && p.emailAddress?.toLowerCase() === email.toLowerCase())
          return false;
        if (domain && p.domain?.toLowerCase() === domain.toLowerCase())
          return false;
        if (scope === "anyone" && p.type === "anyone")
          return false;
        if (scope === "domain" && p.type === "domain")
          return false;
        return true;
      });
    }
  } else {
    let targetPermissionId = permissionId;
    if (!targetPermissionId) {
      const perms = await gwsDrive.listPermissions(targetDoc.docId);
      if (email) {
        const match = perms.find((p) => p.emailAddress?.toLowerCase() === email.toLowerCase());
        if (!match) {
          throw new Error(`steps[${stepIndex}] docPermissionRemove: no permission found matching email "${email}"`);
        }
        targetPermissionId = match.id;
      } else if (domain || scope === "domain") {
        const match = domain ? perms.find((p) => p.type === "domain" && p.domain?.toLowerCase() === domain.toLowerCase()) : perms.find((p) => p.type === "domain");
        if (!match) {
          throw new Error(`steps[${stepIndex}] docPermissionRemove: no domain permission found on document`);
        }
        targetPermissionId = match.id;
      } else if (scope === "anyone") {
        const match = perms.find((p) => p.type === "anyone");
        if (!match) {
          throw new Error(`steps[${stepIndex}] docPermissionRemove: no "anyone" permission found on document`);
        }
        targetPermissionId = match.id;
      }
    }
    if (targetPermissionId) {
      await gwsDrive.deletePermission(targetDoc.docId, targetPermissionId);
    }
  }
  runtime.stepsExecuted++;
};

// src/core/actions/docRename.ts
var docRenameStep = async (runtime, stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const newTitle = step.title;
  if (!newTitle)
    throw new Error(`steps[${stepIndex}] docRename requires title: <string>`);
  if (!runtime.dryRun) {
    await gwsDrive.updateFile(targetDoc.docId, { name: newTitle });
    targetDoc.gdoc.data.title = newTitle;
    docCache.invalidate(targetDoc.docId);
  }
  targetDoc.title = newTitle;
  runtime.stepsExecuted++;
};

// src/core/actions/docTrash.ts
var docTrashStep = async (runtime, _stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  if (!runtime.dryRun) {
    await gwsDrive.updateFile(targetDoc.docId, { trashed: true });
    docCache.invalidate(targetDoc.docId);
  }
  runtime.openDocs.delete(targetDoc.alias);
  runtime.stepsExecuted++;
};

// src/core/actions/stepKind.ts
function stepKindRead(step) {
  const raw = step.kind;
  if (typeof raw !== "string" || !raw.trim())
    return;
  return raw.trim();
}

// src/core/actions/domOpFromStep.ts
var ANCHOR_KEYS = new Set(["after", "at", "before"]);
function domOpFromStep(step, aliasResolve) {
  const mutation = {};
  const s = step;
  for (const key of TAPE_MUTATION_KEYS) {
    if (ANCHOR_KEYS.has(key))
      continue;
    const raw = s[key];
    if (raw === undefined)
      continue;
    if (key === "cloneNode") {
      mutation.cloneNode = cloneRefResolve(raw, aliasResolve);
      continue;
    }
    if (key === "cloneNodes" && Array.isArray(raw)) {
      mutation.cloneNodes = raw.map((item) => cloneRefResolve(item, aliasResolve));
      continue;
    }
    if (key === "insertAdjacentElement" && raw && typeof raw === "object") {
      mutation.insertAdjacentElement = insertAdjacentResolve(raw, aliasResolve);
      continue;
    }
    mutation[key] = raw;
  }
  if (mutation.at === undefined) {
    const rawAt = s.nodeAt ?? s.at;
    if (rawAt !== undefined) {
      const resolved = typeof rawAt === "string" ? aliasResolve(rawAt) : rawAt;
      if (resolved !== undefined)
        mutation.at = resolved;
    }
  }
  if (mutation.after === undefined) {
    const rawAfter = s.nodeAfter ?? s.after;
    if (rawAfter !== undefined) {
      const resolved = typeof rawAfter === "string" ? aliasResolve(rawAfter) : rawAfter;
      if (resolved !== undefined)
        mutation.after = resolved;
    }
  }
  if (mutation.before === undefined) {
    const rawBefore = s.nodeBefore ?? s.before;
    if (rawBefore !== undefined) {
      const resolved = typeof rawBefore === "string" ? aliasResolve(rawBefore) : rawBefore;
      if (resolved !== undefined)
        mutation.before = resolved;
    }
  }
  if (mutation.at === undefined) {
    const under = aliasResolve(s.nodeUnder);
    if (under !== undefined)
      mutation.at = under;
  }
  const kind = stepKindRead(step);
  const replaceMarkdownVal = s.replaceMarkdown;
  const replaceSectionVal = s.replaceSection;
  const insertMarkdownVal = s.insertMarkdown;
  const markdownVal = s.markdown;
  const textVal = s.text;
  const replaceVal = s.replace;
  const innerTextVal = s.innerText;
  if (kind === "replaceMarkdown" || replaceMarkdownVal && typeof replaceMarkdownVal !== "string") {
    mutation.replaceMarkdown = typeof replaceMarkdownVal === "string" ? replaceMarkdownVal : markdownVal ?? textVal;
  } else if (kind === "replaceSection" || replaceSectionVal && typeof replaceSectionVal !== "string") {
    mutation.replaceSection = typeof replaceSectionVal === "string" ? replaceSectionVal : markdownVal ?? textVal;
  } else if (kind === "markdownInsert") {
    mutation.insertMarkdown = typeof insertMarkdownVal === "string" ? insertMarkdownVal : markdownVal ?? textVal;
  } else if (kind === "replace" || s.find != null) {
    mutation.replace = replaceVal ?? textVal ?? innerTextVal;
  } else if (kind === "innerText") {
    mutation.innerText = innerTextVal ?? textVal;
  } else if (replaceVal !== undefined && mutation.replace === undefined) {
    mutation.replace = replaceVal;
  } else if (markdownVal !== undefined && mutation.insertMarkdown === undefined) {
    mutation.insertMarkdown = markdownVal;
  }
  return mutation;
}
function cloneRefResolve(raw, aliasResolve) {
  if (raw && typeof raw === "object") {
    const ref = raw;
    const fromDoc = typeof ref.fromDoc === "string" ? aliasResolve(ref.fromDoc) ?? ref.fromDoc : ref.fromDoc;
    const fromNode = typeof ref.fromNode === "string" ? aliasResolve(String(ref.fromNode)) ?? ref.fromNode : ref.fromNode;
    const fromTab = typeof ref.fromTab === "string" ? aliasResolve(ref.fromTab) ?? ref.fromTab : ref.fromTab;
    const nodeId = typeof ref.nodeId === "string" ? aliasResolve(String(ref.nodeId)) ?? ref.nodeId : ref.nodeId;
    return { ...ref, ...fromDoc !== undefined ? { fromDoc } : {}, fromNode, fromTab, nodeId };
  }
  if (typeof raw === "string")
    return aliasResolve(raw) ?? raw;
  return raw;
}
function insertAdjacentResolve(adj, aliasResolve) {
  const out = { ...adj };
  if (adj.cloneNode !== undefined)
    out.cloneNode = cloneRefResolve(adj.cloneNode, aliasResolve);
  if (Array.isArray(adj.cloneNodes)) {
    out.cloneNodes = adj.cloneNodes.map((item) => cloneRefResolve(item, aliasResolve));
  }
  return out;
}
// src/core/dom/diff.ts
function diffUnifiedFormat(oldText, newText, opts) {
  if (oldText === newText)
    return "";
  const oldLines = oldText ? oldText.split(/\r?\n/) : [];
  const newLines = newText ? newText.split(/\r?\n/) : [];
  const context = opts.contextLines ?? 3;
  const edits = computeLineEdits(oldLines, newLines);
  const hunks = buildHunks(edits, context);
  if (!hunks.length)
    return "";
  const header = [
    `--- ${opts.oldPath}${opts.oldLabel ? `	${opts.oldLabel}` : ""}`,
    `+++ ${opts.newPath}${opts.newLabel ? `	${opts.newLabel}` : ""}`
  ];
  const hunkStrs = hunks.map((hunk) => {
    const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
    const lines = hunk.lines.map((l3) => `${l3.type}${l3.text}`);
    return [hunkHeader, ...lines].join(`
`);
  });
  return [...header, ...hunkStrs].join(`
`);
}
var formatUnifiedDiff = diffUnifiedFormat;
function computeLineEdits(a, b2) {
  const N2 = a.length;
  const M2 = b2.length;
  const dp = Array.from({ length: N2 + 1 }, () => Array(M2 + 1).fill(0));
  for (let i2 = 0;i2 < N2; i2++) {
    for (let j2 = 0;j2 < M2; j2++) {
      if (a[i2] === b2[j2]) {
        dp[i2 + 1][j2 + 1] = dp[i2]?.[j2] + 1;
      } else {
        dp[i2 + 1][j2 + 1] = Math.max(dp[i2 + 1]?.[j2], dp[i2]?.[j2 + 1]);
      }
    }
  }
  const edits = [];
  let i = N2;
  let j = M2;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b2[j - 1]) {
      edits.unshift({ text: a[i - 1], type: "=" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]?.[j - 1] >= dp[i - 1]?.[j])) {
      edits.unshift({ text: b2[j - 1], type: "+" });
      j--;
    } else if (i > 0 && (j === 0 || dp[i]?.[j - 1] < dp[i - 1]?.[j])) {
      edits.unshift({ text: a[i - 1], type: "-" });
      i--;
    }
  }
  return edits;
}
function buildHunks(edits, context) {
  const hunks = [];
  let currentHunk = null;
  let oldLineNum = 1;
  let newLineNum = 1;
  let pendingEquals = [];
  for (let e = 0;e < edits.length; e++) {
    const edit = edits[e];
    if (edit.type === "=") {
      if (!currentHunk) {
        pendingEquals.push({ text: edit.text, type: " " });
        if (pendingEquals.length > context) {
          pendingEquals.shift();
        }
      } else {
        let nextChangeDist = -1;
        for (let k = e;k < edits.length; k++) {
          if (edits[k]?.type !== "=") {
            nextChangeDist = k - e;
            break;
          }
        }
        if (nextChangeDist !== -1 && nextChangeDist <= 2 * context) {
          currentHunk.lines.push({ text: edit.text, type: " " });
          currentHunk.oldCount++;
          currentHunk.newCount++;
        } else {
          currentHunk.lines.push({ text: edit.text, type: " " });
          currentHunk.oldCount++;
          currentHunk.newCount++;
          if (currentHunk.lines.filter((l3) => l3.type === " ").length >= context) {
            hunks.push(currentHunk);
            currentHunk = null;
            pendingEquals = [{ text: edit.text, type: " " }];
          }
        }
      }
      oldLineNum++;
      newLineNum++;
    } else {
      if (!currentHunk) {
        const leadingContext = pendingEquals.slice(-context);
        const oldStart = oldLineNum - leadingContext.length;
        const newStart = newLineNum - leadingContext.length;
        currentHunk = {
          lines: [...leadingContext],
          newCount: leadingContext.length,
          newStart: Math.max(1, newStart),
          oldCount: leadingContext.length,
          oldStart: Math.max(1, oldStart)
        };
        pendingEquals = [];
      }
      if (edit.type === "-") {
        currentHunk.lines.push({ text: edit.text, type: "-" });
        currentHunk.oldCount++;
        oldLineNum++;
      } else if (edit.type === "+") {
        currentHunk.lines.push({ text: edit.text, type: "+" });
        currentHunk.newCount++;
        newLineNum++;
      }
    }
  }
  if (currentHunk) {
    hunks.push(currentHunk);
  }
  return hunks;
}
// src/core/actions/surgicalMutation.ts
async function surgicalMutationExecute(runtime, step, mutation) {
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  const liveTab = targetDoc.gdoc.data.tabs?.length ? resolveTab(targetDoc.gdoc.data, tabHint) : { tabId: undefined, title: targetDoc.title };
  const tabKey = liveTab.tabId ?? "default";
  if ("dangerousClear" in step && step.dangerousClear) {
    await pendingWritersFlush(runtime, targetDoc.alias);
  }
  const op = mutationFoldClones(mutation);
  if (mutationHasCloneRefs(op)) {
    await pendingWritersFlush(runtime);
    await cloneNodeOpsResolve([op], {
      client: runtime.client,
      defaultDoc: targetDoc.gdoc,
      defaultDocumentId: targetDoc.docId,
      defaultTabId: liveTab.tabId
    });
  }
  const isTableInsert = mutationContainsTable(op);
  if (isTableInsert) {
    await pendingWritersFlush(runtime, targetDoc.alias);
  }
  if (!targetDoc.pendingWriters) {
    targetDoc.pendingWriters = new Map;
  }
  let pending = targetDoc.pendingWriters.get(tabKey);
  if (!pending) {
    const gdoc = liveTab.tabId ? targetDoc.gdoc.withTab(liveTab.tabId) : targetDoc.gdoc;
    const simulated = simulatedNodesOf(targetDoc.gdoc, liveTab.tabId);
    const parsed = simulated ? { nodes: simulated, segments: [], title: targetDoc.title } : parseDocument(gdoc);
    const simTabs = targetDoc.gdoc.simulatedTabs;
    const writer = new DomWriter(parsed.nodes, {
      doc: targetDoc.gdoc.data,
      force: runtime.force,
      lists: gdoc.data.lists,
      simulatedTabs: simTabs,
      tabId: liveTab.tabId
    });
    if ("dangerousClear" in step && step.dangerousClear) {
      dangerousClearExecute(writer);
    }
    pending = {
      afterendTails: new Map,
      doc: gdoc.data,
      namedAnchors: new Map,
      plans: [],
      rootAnchors: new Map,
      steps: [],
      writer
    };
    targetDoc.pendingWriters.set(tabKey, pending);
  } else if ("dangerousClear" in step && step.dangerousClear) {
    dangerousClearExecute(pending.writer);
  }
  const force = runtime.force || Boolean(op.force);
  if (mutationHasWrite(op)) {
    const plans = tapeMutationsApply(pending.writer, [op], pending.writer.mutations().length, {
      afterendTails: pending.afterendTails,
      force,
      namedAnchors: pending.namedAnchors,
      rootAnchors: pending.rootAnchors
    });
    if (plans?.length) {
      pending.plans.push(...plans);
    }
  }
  pending.steps.push({ op, step, stepIndex: runtime.stepsExecuted });
  assignScopedIds(pending.writer.nodes);
  simulatedNodesSet(targetDoc.gdoc, pending.writer.nodes, liveTab.tabId);
  if (step.as) {
    const namedNode = pending.namedAnchors.get(step.as);
    if (namedNode?.scopedId) {
      runtime.aliasMap.set(step.as, namedNode.scopedId);
    }
  }
  if (liveTab.tabId && targetDoc.gdoc.data.tabs?.length) {
    const tab = findTab(targetDoc.gdoc.data.tabs, liveTab.tabId);
    if (tab) {
      if (!tab.documentTab)
        tab.documentTab = {};
      const elements = pending.writer.nodes.map((n, i) => ({
        endIndex: (i + 1) * 2,
        paragraph: {
          elements: [{ textRun: { content: `${n.text ?? ""}
` } }],
          paragraphStyle: { namedStyleType: n.namedStyleType ?? "NORMAL_TEXT" }
        },
        startIndex: i * 2
      }));
      tab.documentTab.body = { content: elements };
    }
  }
  if (isTableInsert) {
    await pendingWritersFlush(runtime, targetDoc.alias);
  }
  runtime.stepsExecuted++;
}
function mutationHasWrite(mutation) {
  return Object.entries(mutation).some(([key, val]) => key !== "as" && val !== undefined);
}
function mutationHasCloneRefs(mutation) {
  const adj = mutation.insertAdjacentElement;
  if (!adj)
    return mutation.cloneNode != null || Array.isArray(mutation.cloneNodes) && mutation.cloneNodes.length > 0;
  return adj.cloneNode != null || Array.isArray(adj.cloneNodes) && adj.cloneNodes.length > 0;
}
function mutationContainsTable(mutation) {
  const adj = mutation.insertAdjacentElement;
  if (!adj)
    return false;
  if (adj.element?.kind === "table")
    return true;
  return Array.isArray(adj.elements) && adj.elements.some((el) => el.kind === "table");
}
function mutationFoldClones(mutation) {
  const op = { ...mutation };
  if (op.element != null || op.elements != null || op.cloneNode != null || op.cloneNodes != null) {
    if (op.insertAdjacentElement != null) {
      return op;
    }
    op.insertAdjacentElement = {
      cloneNode: op.cloneNode,
      cloneNodes: op.cloneNodes,
      element: op.element,
      elements: op.elements
    };
    delete op.cloneNode;
    delete op.cloneNodes;
    delete op.element;
    delete op.elements;
  }
  return op;
}

// src/core/actions/innerText.ts
var innerTextStep = async (runtime, _stepIndex, step) => {
  const mutation = domOpFromStep(step, runtime.aliasResolve);
  if (step.innerText !== undefined)
    mutation.innerText = step.innerText;
  if (step.text !== undefined && mutation.innerText === undefined)
    mutation.innerText = step.text;
  await surgicalMutationExecute(runtime, step, mutation);
};

// src/core/actions/markdownInsert.ts
import { readFileSync as readFileSync7 } from "node:fs";

// src/core/revisions.ts
class DriveRevisions {
  static async pinHead(fileId, client = gws) {
    let head = null;
    try {
      const out = await client.run([
        "drive",
        "revisions",
        "list",
        "--params",
        JSON.stringify({
          fields: "revisions(id,modifiedTime,keepForever)",
          fileId,
          pageSize: 1000
        })
      ]);
      head = DriveRevisions.#newest(DriveRevisions.#parseList(out));
    } catch {
      return null;
    }
    if (!head)
      return null;
    try {
      await client.run([
        "drive",
        "revisions",
        "update",
        "--params",
        JSON.stringify({ fileId, revisionId: head.id }),
        "--json",
        JSON.stringify({ keepForever: true })
      ]);
      return { ...head, keepForever: true };
    } catch {
      return head;
    }
  }
  static restoreHint(fileId, revisionId) {
    const url = `https://docs.google.com/document/d/${fileId}/revisions/revisions`;
    const pin = revisionId ? `Pinned Drive revision ${revisionId} before apply. ` : "";
    return `${pin}Docs API cannot roll back in-place. ` + `Restore: File → Version history (${url}).`;
  }
  static #parseList(out) {
    const json = DriveRevisions.#parseJson(out);
    if (Array.isArray(json))
      return json;
    if (json && typeof json === "object" && "revisions" in json) {
      const revs = json.revisions;
      return Array.isArray(revs) ? revs : [];
    }
    return [];
  }
  static #parseJson(out) {
    const text = out.trim();
    const startObj = text.indexOf("{");
    const startArr = text.indexOf("[");
    let start = -1;
    if (startObj >= 0 && (startArr < 0 || startObj < startArr))
      start = startObj;
    else if (startArr >= 0)
      start = startArr;
    if (start < 0)
      return null;
    try {
      return JSON.parse(text.slice(start));
    } catch {
      return null;
    }
  }
  static #newest(revs) {
    const withId = revs.filter((r) => Boolean(r.id));
    if (!withId.length)
      return null;
    const dated = withId.filter((r) => r.modifiedTime);
    const pool = dated.length ? dated : withId;
    pool.sort((a, b2) => Date.parse(a.modifiedTime ?? "") - Date.parse(b2.modifiedTime ?? ""));
    const head = pool.at(-1);
    return {
      id: head.id,
      keepForever: head.keepForever,
      modifiedTime: head.modifiedTime
    };
  }
}

// src/core/markdown.ts
async function elementsInsertExecute(params) {
  const client = params.client ?? gws;
  const elements = params.elements;
  const effectiveStyles = params.customStyles ?? {};
  if (!elements.length) {
    return {
      appliedChunks: 0,
      elementsInserted: 0,
      message: "No elements found to insert."
    };
  }
  const chunks = chunkMarkdownElements(elements);
  let freshDoc = await Gdoc.load(params.documentId, client);
  const tabResolution = freshDoc.data.tabs?.length ? resolveTab(freshDoc.data, params.tabHint) : {};
  const tabId = tabResolution.tabId;
  let gdoc = tabId ? freshDoc.withTab(tabId) : freshDoc;
  let parsedDoc = parseDocument(gdoc);
  let currentAnchorId;
  let replaceAnchor = false;
  if (params.anchorId != null) {
    const hit = findNodeAt(parsedDoc.nodes, params.anchorId);
    if (!hit) {
      throw new Error(missingNodeIdMsg(params.anchorId, parsedDoc.nodes.length));
    }
    currentAnchorId = hit.tapeIndex;
  } else {
    const contentNodes = parsedDoc.nodes.filter((n) => n.kind !== "sectionBreak");
    if (contentNodes.length === 1 && contentNodes[0]?.kind === "paragraph" && !contentNodes[0]?.text) {
      currentAnchorId = contentNodes[0]?.tapeIndex;
      replaceAnchor = true;
    } else {
      const target = contentNodes[contentNodes.length - 1] ?? parsedDoc.nodes[parsedDoc.nodes.length - 1];
      if (!target) {
        throw new Error("Document has no nodes to insert content into.");
      }
      currentAnchorId = target.tapeIndex;
    }
  }
  const effectivePosition = params.position ?? "afterend";
  const originalAnchorId = currentAnchorId;
  const originalReplaceAnchor = replaceAnchor;
  return await InlineMarkup.withStyles(effectiveStyles, async () => {
    await DriveRevisions.pinHead(params.documentId, params.client ?? gws);
    let chunksApplied = 0;
    for (let cIdx = 0;cIdx < chunks.length; cIdx++) {
      const chunk = chunks[cIdx];
      const writer = new DomWriter(parsedDoc.nodes, {
        force: params.force,
        lists: gdoc.data.lists,
        tabId
      });
      const isReplacing = cIdx === 0 && replaceAnchor;
      const ops = buildChunkOps(currentAnchorId, effectivePosition, chunk, isReplacing);
      const plan = applyOps(writer, ops);
      await applyDom(params.documentId, writer, {
        client,
        doc: gdoc.data,
        force: params.force,
        plan
      });
      chunksApplied++;
      if (cIdx < chunks.length - 1) {
        freshDoc = await Gdoc.load(params.documentId, client, { forceFetch: true });
        gdoc = tabId ? freshDoc.withTab(tabId) : freshDoc;
        parsedDoc = parseDocument(gdoc);
        const lastSpec = chunk.kind === "table" ? chunk.spec : chunk.specs[chunk.specs.length - 1];
        const matchingNode = parsedDoc.nodes.find((n) => {
          if (lastSpec.kind === "table" && n.kind === "table") {
            return true;
          }
          if (lastSpec.kind === "paragraph" && n.kind === "paragraph") {
            return n.text === lastSpec.text;
          }
          return false;
        });
        if (matchingNode) {
          currentAnchorId = matchingNode.tapeIndex;
        } else {
          currentAnchorId = parsedDoc.nodes[parsedDoc.nodes.length - 1]?.tapeIndex;
        }
      }
    }
    const startId = originalReplaceAnchor || effectivePosition === "beforebegin" ? originalAnchorId : originalAnchorId + 1;
    const endId = startId + elements.length - 1;
    return {
      appliedChunks: chunksApplied,
      elementsInserted: elements.length,
      insertedRange: {
        count: elements.length,
        endId,
        startId
      },
      message: `Inserted ${elements.length} element(s) into document (${chunksApplied} batch(es)).`,
      tabId
    };
  });
}
var executeElementsInsert = elementsInsertExecute;
async function markdownInsertExecute(params) {
  const elements = parseMarkdownToElements(params.markdown, {
    customStyles: params.customStyles,
    h1IsTitle: params.h1IsTitle,
    linkResolver: params.linkResolver
  });
  return executeElementsInsert({
    anchorId: params.anchorId,
    client: params.client,
    customStyles: params.customStyles,
    documentId: params.documentId,
    elements,
    force: params.force,
    position: params.position,
    tabHint: params.tabHint
  });
}
function chunkOpsBuild(anchorId, position, chunk, replaceAnchor) {
  const ops = [];
  if (chunk.kind === "table") {
    ops.push({
      at: anchorId,
      insertAdjacentElement: {
        element: chunk.spec,
        position: replaceAnchor ? "afterend" : position
      }
    });
    if (replaceAnchor) {
      ops.push({
        at: anchorId,
        remove: true
      });
    }
    return ops;
  }
  const specs = chunk.specs;
  if (!specs.length)
    return ops;
  const first = specs[0];
  if (replaceAnchor && first && first.kind === "paragraph" && (!first.bullet || (first.bullet.nestingLevel ?? 0) === 0)) {
    const op = {
      at: anchorId,
      innerText: first.text
    };
    if (first.namedStyleType && first.namedStyleType !== "NORMAL_TEXT") {
      op.namedStyleType = first.namedStyleType;
    }
    if (first.style) {
      op.style = first.style;
    }
    if (first.bullet) {
      op.bullet = first.bullet;
    }
    if (first.runs?.length) {
      op.runs = first.runs;
    }
    ops.push(op);
    const remaining = specs.slice(1);
    if (remaining.length > 0) {
      ops.push({
        at: anchorId,
        insertAdjacentElement: {
          elements: remaining,
          position: "afterend"
        }
      });
    }
  } else if (replaceAnchor) {
    ops.push({
      at: anchorId,
      insertAdjacentElement: {
        elements: specs,
        position: "afterend"
      }
    });
    ops.push({
      at: anchorId,
      remove: true
    });
  } else {
    ops.push({
      at: anchorId,
      insertAdjacentElement: {
        elements: specs,
        position
      }
    });
  }
  return ops;
}
var buildChunkOps = chunkOpsBuild;

// src/core/actions/markdownInsert.ts
var markdownInsertStep = async (runtime, stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  let markdown = step.markdown ?? step.text;
  if (!markdown && step.file) {
    markdown = step.file === "-" ? readFileSync7(0, "utf8") : readFileSync7(step.file, "utf8");
  }
  if (!markdown) {
    throw new Error(`steps[${stepIndex}] markdownInsert requires markdown:, text:, or file:`);
  }
  const rawAnchor = step.nodeAt ?? step.nodeAfter ?? step.nodeBefore;
  const anchorId = runtime.aliasResolve(rawAnchor);
  const position = step.nodeBefore != null ? "beforebegin" : "afterend";
  const h1IsTitle = Boolean(step.h1IsTitle);
  const customStyles = markdownStylesParse(step.markdownStyles ?? null);
  const liveTab = targetDoc.gdoc.data.tabs?.length ? resolveTab(targetDoc.gdoc.data, tabHint) : { tabId: undefined, title: targetDoc.title };
  if (!runtime.dryRun) {
    await pendingWritersFlush(runtime, targetDoc.alias);
    await markdownInsertExecute({
      anchorId,
      client: runtime.client,
      customStyles,
      doc: targetDoc.gdoc.data,
      documentId: targetDoc.docId,
      force: runtime.force,
      h1IsTitle,
      linkResolver: createSymbolicLinkResolver({ currentTabId: liveTab.tabId, doc: targetDoc.gdoc.data }),
      markdown,
      position,
      tabHint
    });
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
  } else {
    const gdoc = liveTab.tabId ? targetDoc.gdoc.withTab(liveTab.tabId) : targetDoc.gdoc;
    const simulatedNodes = simulatedNodesOf(targetDoc.gdoc, liveTab.tabId);
    const parsed = simulatedNodes ? { nodes: simulatedNodes, segments: [], title: targetDoc.title } : parseDocument(gdoc);
    const simTabs = targetDoc.gdoc.simulatedTabs;
    const writer = new DomWriter(parsed.nodes, {
      doc: targetDoc.gdoc.data,
      force: runtime.force,
      lists: gdoc.data.lists,
      simulatedTabs: simTabs,
      tabId: liveTab.tabId
    });
    const elements = parseMarkdownToElements(markdown, {
      customStyles,
      h1IsTitle,
      linkResolver: writer.linkResolver
    });
    if (elements.length > 0) {
      const startAnchor = anchorId ? findNodeAt(parsed.nodes, anchorId) : parsed.nodes[parsed.nodes.length - 1];
      if (startAnchor) {
        let anchorNode = startAnchor;
        for (const el of elements) {
          const created = writer.insertAdjacentElement(anchorNode, position, el);
          if (position === "afterend")
            anchorNode = created;
        }
      }
    }
    const existingSim = targetDoc.gdoc;
    const simNodes = existingSim.simulatedNodes;
    targetDoc.gdoc = new Gdoc({
      ...targetDoc.gdoc.data
    }, targetDoc.docId);
    if (simNodes)
      targetDoc.gdoc.simulatedNodes = simNodes;
    if (simTabs)
      targetDoc.gdoc.simulatedTabs = simTabs;
    assignScopedIds(writer.nodes);
    simulatedNodesSet(targetDoc.gdoc, writer.nodes, liveTab.tabId);
    if (liveTab.tabId && targetDoc.gdoc.data.tabs?.length) {
      const tab = findTab(targetDoc.gdoc.data.tabs, liveTab.tabId);
      if (tab) {
        if (!tab.documentTab)
          tab.documentTab = {};
        const elements2 = writer.nodes.map((n, i) => ({
          endIndex: (i + 1) * 2,
          paragraph: {
            elements: [{ textRun: { content: `${n.text ?? ""}
` } }],
            paragraphStyle: { namedStyleType: n.namedStyleType ?? "NORMAL_TEXT" }
          },
          startIndex: i * 2
        }));
        tab.documentTab.body = { content: elements2 };
      }
    }
  }
  const resolvedTab = targetDoc.gdoc.data.tabs?.length ? resolveTab(targetDoc.gdoc.data, tabHint) : { tabId: undefined, title: targetDoc.title };
  const targetTabId = resolvedTab.tabId ?? "t.0";
  const simulated = simulatedNodesOf(targetDoc.gdoc, resolvedTab.tabId);
  const afterParsed = simulated ? { nodes: simulated } : parseDocument(resolvedTab.tabId ? targetDoc.gdoc.withTab(resolvedTab.tabId) : targetDoc.gdoc);
  const headings = afterParsed.nodes.filter((n) => n.kind === "paragraph" && (n.namedStyleType?.startsWith("HEADING_") || n.namedStyleType === "TITLE")).map((h) => ({ id: h.headingId ?? String(h.tapeIndex), text: h.text ?? "" }));
  if (headings.length > 0) {
    let docHighlight = runtime.createdHighlights.get(targetDoc.alias);
    if (!docHighlight) {
      docHighlight = { as: targetDoc.alias, id: targetDoc.docId, tabs: [], title: targetDoc.title };
      runtime.createdHighlights.set(targetDoc.alias, docHighlight);
    }
    docHighlight.tabs = docHighlight.tabs ?? [];
    let tabHighlight = docHighlight.tabs.find((t) => t.id === targetTabId);
    if (!tabHighlight) {
      tabHighlight = { id: targetTabId };
      docHighlight.tabs.push(tabHighlight);
    }
    tabHighlight.headings = headings;
  }
  runtime.stepsExecuted++;
};

// src/core/actions/open.ts
var openStep = async (runtime, stepIndex, step) => {
  const rawDocId = step.doc;
  if (!rawDocId)
    throw new Error(`steps[${stepIndex}] ${step.kind ?? "docOpen"} requires doc: <docId>`);
  const as = step.as;
  if (!as)
    throw new Error(`steps[${stepIndex}] ${step.kind ?? "docOpen"} requires "as: <alias>"`);
  const docId = Gdoc.parseId(runtime.aliasResolve(rawDocId));
  let gdoc;
  let title = "Document";
  let pinnedRevisionId;
  if (runtime.dryRun) {
    const preloaded = runtime.preloadedDocs?.get(docId);
    if (preloaded) {
      gdoc = preloaded;
      title = gdoc.data.title || title;
    } else {
      try {
        gdoc = await Gdoc.load(docId, runtime.client);
        title = gdoc.data.title || title;
      } catch {
        gdoc = new Gdoc({
          body: {
            content: [
              { endIndex: 1, sectionBreak: {}, startIndex: 0 },
              {
                endIndex: 2,
                paragraph: { elements: [{ textRun: { content: `
` } }] },
                startIndex: 1
              }
            ]
          },
          documentId: docId,
          revisionId: "dry-run",
          tabs: [
            {
              documentTab: {
                body: {
                  content: [
                    { endIndex: 1, sectionBreak: {}, startIndex: 0 },
                    {
                      endIndex: 2,
                      paragraph: { elements: [{ textRun: { content: `
` } }] },
                      startIndex: 1
                    }
                  ]
                }
              },
              tabProperties: {
                tabId: "t.0",
                title
              }
            }
          ],
          title
        }, docId);
      }
    }
  } else {
    gdoc = runtime.preloadedDocs?.get(docId) ?? await Gdoc.load(docId, runtime.client);
    title = gdoc.data.title || title;
    const pin = await DriveRevisions.pinHead(docId, runtime.client);
    pinnedRevisionId = pin?.id;
  }
  const openContext = {
    alias: as,
    docId,
    gdoc,
    pinnedRevisionId,
    title
  };
  const tabs = flattenTabs(gdoc.data.tabs);
  const tabsToCheck = tabs.length > 0 ? tabs : [{ tabId: "t.0", title }];
  const dumpPayload = {
    alias: as,
    id: docId,
    kind: "doc",
    pageSetup: pageSetupExtract(gdoc.data.documentStyle ?? gdoc.data.tabs?.[0]?.documentTab?.documentStyle),
    tabs: tabsToCheck.map((t) => {
      const tabSetup = pageSetupExtract(t.tabId && gdoc.data.tabs?.length ? gdoc.withTab(t.tabId).data.documentStyle : gdoc.data.documentStyle);
      return {
        id: t.tabId,
        kind: "tab",
        ...tabSetup ? { pageSetup: tabSetup } : {},
        title: t.title
      };
    }),
    title
  };
  runtime.openDocs.set(as, openContext);
  runtime.docIdToAlias.set(docId, as);
  runtime.aliasMap.set(as, docId);
  runtime.dumpStore.set(as, dumpPayload);
  if (step.dump) {
    runtime.dumped[as] = dumpPayload;
  }
  runtime.activeDocAlias = as;
  if (runtime.dryRun) {
    for (const t of tabsToCheck) {
      const key = `${as}/${t.tabId}`;
      if (!runtime.initialMarkdownStates.has(key)) {
        const md = await runtime.tabMarkdownCapture(openContext, t.tabId);
        runtime.initialMarkdownStates.set(key, md);
      }
    }
  }
  runtime.stepsExecuted++;
};

// src/core/actions/pageSetup.ts
var pageSetupStep = async (runtime, stepIndex, step) => {
  if (step.doc) {
    await pendingWritersFlush(runtime, step.doc);
  }
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  const resolvedTab = tabHint && targetDoc.gdoc.data.tabs?.length ? resolveTab(targetDoc.gdoc.data, tabHint) : undefined;
  const tabId = resolvedTab?.tabId;
  const mode = step.mode ?? step.pageSetup?.mode ?? (step.pageless !== undefined ? step.pageless ? "PAGELESS" : "PAGES" : step.pageSetup?.pageless !== undefined ? step.pageSetup.pageless ? "PAGELESS" : "PAGES" : undefined);
  const effectivePageSetup = {
    ...step.pageSetup ?? {},
    ...step.margins ? { margins: step.margins } : {},
    ...step.orientation ? { orientation: step.orientation } : {},
    ...step.pageHeight != null ? { pageHeight: step.pageHeight } : {},
    ...step.pageSize ? { pageSize: step.pageSize } : {},
    ...step.pageWidth != null ? { pageWidth: step.pageWidth } : {},
    ...mode ? { mode, pageless: mode === "PAGELESS" } : {}
  };
  const req = buildDocumentStyleRequest(effectivePageSetup, tabId);
  if (!("updateDocumentStyle" in req)) {
    throw new Error(`steps[${stepIndex}] pageSetup requires margins, mode, orientation, pageSize, or pageless`);
  }
  if (!runtime.dryRun) {
    await runtime.client.batchUpdate(targetDoc.docId, [req]);
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
  } else {
    const updateStyle = req.updateDocumentStyle.documentStyle;
    const targetTab = tabId ? targetDoc.gdoc.data.tabs?.find((t) => t.tabProperties?.tabId === tabId) : undefined;
    let baseStyle;
    if (targetTab) {
      targetTab.documentTab = targetTab.documentTab ?? {};
      targetTab.documentTab.documentStyle = targetTab.documentTab.documentStyle ?? {};
      baseStyle = targetTab.documentTab.documentStyle;
    } else {
      targetDoc.gdoc.data.documentStyle = targetDoc.gdoc.data.documentStyle ?? {};
      baseStyle = targetDoc.gdoc.data.documentStyle;
      if (targetDoc.gdoc.data.tabs?.length) {
        const firstTab = targetDoc.gdoc.data.tabs[0];
        firstTab.documentTab = firstTab.documentTab ?? {};
        firstTab.documentTab.documentStyle = targetDoc.gdoc.data.documentStyle;
      }
    }
    if (updateStyle.documentFormat) {
      baseStyle.documentFormat = updateStyle.documentFormat;
    }
    if (updateStyle.marginTop) {
      baseStyle.marginTop = updateStyle.marginTop;
    }
    if (updateStyle.marginBottom) {
      baseStyle.marginBottom = updateStyle.marginBottom;
    }
    if (updateStyle.marginLeft) {
      baseStyle.marginLeft = updateStyle.marginLeft;
    }
    if (updateStyle.marginRight) {
      baseStyle.marginRight = updateStyle.marginRight;
    }
    if (updateStyle.pageSize) {
      baseStyle.pageSize = updateStyle.pageSize;
    }
  }
  const effectiveDocStyle = (tabId ? targetDoc.gdoc.withTab(tabId).data.documentStyle : undefined) ?? targetDoc.gdoc.data.documentStyle ?? targetDoc.gdoc.data.tabs?.[0]?.documentTab?.documentStyle;
  const dumpPayload = {
    alias: step.as,
    id: targetDoc.docId,
    kind: "pageSetup",
    pageSetup: pageSetupExtract(effectiveDocStyle),
    ...tabId ? { tabId } : {}
  };
  if (step.as) {
    runtime.dumpStore.set(step.as, dumpPayload);
  }
  if (step.dump || step.as) {
    runtime.dumped[step.as ?? targetDoc.alias] = dumpPayload;
  }
  runtime.stepsExecuted++;
};

// src/core/actions/query.ts
var queryStep = async (runtime, stepIndex, step) => {
  const as = step.as;
  if (!as)
    throw new Error(`steps[${stepIndex}] query requires "as: <alias>"`);
  if (step.doc) {
    await pendingWritersFlush(runtime, step.doc);
  }
  const output = queryOutputRead(step.output, stepIndex);
  const full = Boolean(step.full);
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  const hasTabs = Boolean(targetDoc.gdoc.data.tabs?.length);
  const isMultiTab = (targetDoc.gdoc.data.tabs?.length ?? 0) > 1;
  let liveTab = { tabId: undefined, title: targetDoc.title };
  if (tabHint && hasTabs) {
    liveTab = resolveTab(targetDoc.gdoc.data, tabHint);
  } else if (!tabHint && targetDoc.gdoc.data.tabs?.length === 1) {
    liveTab = resolveTab(targetDoc.gdoc.data);
  }
  const targetTabId = hasTabs ? liveTab.tabId ?? tabHint : undefined;
  const simulated = isMultiTab && !targetTabId ? undefined : simulatedNodesOf(targetDoc.gdoc, targetTabId);
  const underTarget = step.nodeUnder;
  const filtered = Boolean(underTarget) || Boolean(step.contains) || Boolean(step.stylesOnly) || Boolean(step.unsafeOnly) || Boolean(step.cols?.length) || Boolean(step.fontColors?.length) || Boolean(step.headingLevels?.length) || Boolean(step.nestingLevels?.length) || Boolean(step.nodeKinds?.length) || Boolean(step.rows?.length) || Boolean(step.sameList);
  const wholeDocument = !tabHint && !filtered && (output === "markdown" || output === "outline" || output === "headings");
  const tabInputs = wholeDocument ? documentTabsParse(targetDoc.gdoc, targetDoc.title) : [singleTabParse(targetDoc, tabHint, simulated, targetDoc.title)];
  for (const tab of tabInputs) {
    tab.nodes = queryNodesFilter(tab.nodes, step, runtime.aliasResolve);
  }
  const nodes = tabInputs.flatMap((t) => t.nodes);
  if (filtered && nodes.length === 0) {
    throw new Error(`steps[${stepIndex}] query: no nodes matched`);
  }
  runtime.queryAliases.add(as);
  const activeTabId = tabInputs[0]?.tabId;
  const effectiveDocStyle = (activeTabId ? targetDoc.gdoc.withTab(activeTabId).data.documentStyle : undefined) ?? targetDoc.gdoc.data.documentStyle ?? targetDoc.gdoc.data.tabs?.[0]?.documentTab?.documentStyle;
  const payload = queryPayloadBuild({
    alias: as,
    documentId: targetDoc.docId,
    full,
    nodes,
    output,
    pageSetup: pageSetupExtract(effectiveDocStyle),
    tabInputs,
    unfiltered: !filtered
  });
  runtime.dumpStore.set(as, payload);
  runtime.dumped[as] = payload;
  runtime.stepsExecuted++;
};
var QUERY_OUTPUTS = new Set(["headings", "markdown", "nodes", "outline"]);
function singleTabParse(targetDoc, tabHint, simulated, title) {
  const liveTab = targetDoc.gdoc.data.tabs?.length ? resolveTab(targetDoc.gdoc.data, tabHint) : { tabId: undefined, title: targetDoc.title };
  const targetTabId = targetDoc.gdoc.data.tabs?.length ? liveTab.tabId ?? tabHint : undefined;
  const gdoc = targetTabId ? targetDoc.gdoc.withTab(targetTabId) : targetDoc.gdoc;
  if (simulated) {
    return { nodes: simulated, tabId: targetTabId ?? "t.0", tabTitle: liveTab.title || title };
  }
  const parsed = parseDocument(gdoc);
  return { nodes: parsed.nodes, tabId: targetTabId, tabTitle: liveTab.title || parsed.title || title };
}
function documentTabsParse(gdoc, title) {
  const tabs = flattenTabs(gdoc.data.tabs);
  const roster = tabs.length > 0 ? tabs : [{ tabId: "t.0", title }];
  return roster.map((t) => {
    const sim = simulatedNodesOf(gdoc, t.tabId);
    if (sim) {
      return { nodes: sim, tabId: t.tabId, tabTitle: t.title || title };
    }
    const parsed = parseDocument(t.tabId ? gdoc.withTab(t.tabId) : gdoc);
    return { nodes: parsed.nodes, tabId: t.tabId, tabTitle: t.title || parsed.title };
  });
}
function nodeIsUnsafe(node) {
  return Boolean(node.hasEquation) || Boolean(node.chips?.length) || Boolean(node.hasHorizontalRule) || node.kind === "tableOfContents";
}
function queryPayloadBuild(opts) {
  if (opts.output === "markdown") {
    const exp = exportDocumentToMarkdown(opts.tabInputs, { documentId: opts.documentId, includeStyles: false });
    return {
      alias: opts.alias,
      id: opts.documentId,
      kind: "markdown",
      markdown: exp.markdown
    };
  }
  if (opts.output === "outline" || opts.output === "headings") {
    const tabsOutline = opts.tabInputs.map((tab) => {
      const headings = tab.nodes.filter((n) => isHeading(n)).map((h) => ({
        headingId: h.headingId,
        id: h.scopedId ?? h.tapeIndex,
        level: headingLevel(h),
        link: h.headingId ? tab.tabId ? `?tab=${tab.tabId}#heading=${h.headingId}` : `#heading=${h.headingId}` : undefined,
        namedStyleType: h.namedStyleType,
        text: (h.text ?? "").trim()
      }));
      return {
        headings,
        tabId: tab.tabId,
        tabTitle: tab.tabTitle
      };
    });
    const allHeadings = tabsOutline.flatMap((t) => t.headings.map((h) => ({
      ...h,
      tabId: t.tabId,
      tabTitle: t.tabTitle
    })));
    return {
      alias: opts.alias,
      headings: allHeadings,
      id: opts.documentId,
      kind: "outline",
      tabs: tabsOutline
    };
  }
  if (opts.unfiltered && opts.nodes.length > TAPE_ECHO_CAP && !opts.full) {
    const first = opts.tabInputs[0];
    return liveDump({
      documentId: opts.documentId,
      full: false,
      nodes: opts.nodes,
      pageSetup: opts.pageSetup,
      tabId: first?.tabId,
      tabTitle: first?.tabTitle
    });
  }
  return opts.nodes.map((n) => nodeSummarize(n, { full: opts.full }));
}
function queryOutputRead(raw, stepIndex) {
  if (raw == null || raw === "")
    return "nodes";
  if (typeof raw === "string" && QUERY_OUTPUTS.has(raw)) {
    return raw;
  }
  throw new Error(`steps[${stepIndex}] query output must be nodes, markdown, outline, or headings`);
}
function queryNodesFilter(nodes, step, aliasResolve) {
  let out = nodes;
  const underTarget = step.nodeUnder;
  if (underTarget) {
    out = neighborhoodFrom(out, aliasResolve(underTarget) ?? underTarget, { sameList: step.sameList });
  }
  if (step.rows?.length || step.cols?.length) {
    out = out.flatMap((n) => n.kind === "table" ? tableCellsAsNodes(n) : [n]);
  }
  if (step.nodeKinds?.length) {
    out = out.filter((n) => step.nodeKinds.includes(n.kind));
  }
  if (step.headingLevels?.length) {
    out = out.filter((n) => isHeading(n) && step.headingLevels.includes(headingLevel(n)));
  }
  if (step.nestingLevels?.length) {
    out = out.filter((n) => n.bullet != null && step.nestingLevels.includes(n.bullet.nestingLevel ?? 0));
  }
  if (step.rows?.length) {
    out = out.filter((n) => n.row != null && step.rows.includes(n.row));
  }
  if (step.cols?.length) {
    out = out.filter((n) => n.col != null && step.cols.includes(n.col));
  }
  if (step.fontColors?.length) {
    out = out.filter((n) => {
      const colors = n.fontColors ?? (n.style?.foregroundColor ? [n.style.foregroundColor] : []);
      return fontColorsMatch(colors, step.fontColors);
    });
  }
  if (step.contains) {
    const lower = step.contains.toLowerCase();
    out = out.filter((n) => (n.text ?? "").toLowerCase().includes(lower));
  }
  if (step.stylesOnly) {
    out = out.filter((n) => n.style != null || (n.fontColors?.length ?? 0) > 0);
  }
  if (step.unsafeOnly) {
    out = out.filter((n) => nodeIsUnsafe(n));
  }
  return out;
}

// src/core/actions/remove.ts
var removeStep = async (runtime, _stepIndex, step) => {
  const mutation = domOpFromStep(step, runtime.aliasResolve);
  if (step.dangerousRemoveSection || step.kind === "dangerousRemoveSection") {
    mutation.dangerousRemoveSection = true;
    delete mutation.remove;
  } else {
    mutation.remove = true;
    delete mutation.dangerousRemoveSection;
  }
  await surgicalMutationExecute(runtime, step, mutation);
};

// src/core/actions/replace.ts
var replaceStep = async (runtime, _stepIndex, step) => {
  const mutation = domOpFromStep(step, runtime.aliasResolve);
  mutation.replace = step.replace ?? step.text ?? step.innerText;
  await surgicalMutationExecute(runtime, step, mutation);
};

// src/core/actions/sectionCopy.ts
var sectionCopyStep = async (runtime, stepIndex, step) => {
  const fromSection = step.fromSection;
  if (!fromSection) {
    throw new Error(`steps[${stepIndex}] sectionCopy requires fromSection: <headingTitle|slug|headingId>`);
  }
  const targetDoc = runtime.openDocResolve(step.doc);
  const sourceDocRef = runtime.aliasResolve(step.fromDoc);
  const sourceDoc = sourceDocRef ? runtime.openDocResolve(sourceDocRef) : targetDoc;
  const sourceTabHint = runtime.aliasResolve(step.fromTab);
  const resolvedSourceTab = sourceDoc.gdoc.data.tabs?.length ? resolveTab(sourceDoc.gdoc.data, sourceTabHint) : { tabId: undefined, title: sourceDoc.title };
  const sourceTabId = sourceDoc.gdoc.data.tabs?.length ? resolvedSourceTab.tabId ?? sourceTabHint : undefined;
  const sourceSim = simulatedNodesOf(sourceDoc.gdoc, sourceTabId);
  const sourceNodes = sourceSim ?? parseDocument(sourceTabId ? sourceDoc.gdoc.withTab(sourceTabId) : sourceDoc.gdoc).nodes;
  const hitHeading = headingByTitleOrSlugFind(sourceNodes, fromSection) ?? nodeAtFind(sourceNodes, fromSection);
  if (!hitHeading || !isHeading(hitHeading)) {
    const known = sourceNodes.filter((n) => isHeading(n)).map((h) => `"${(h.text ?? "").trim()}"`).filter(Boolean).join(", ");
    throw new Error(`steps[${stepIndex}] sectionCopy: heading "${fromSection}" not found in source doc "${sourceDoc.alias}".${known ? ` Known headings: ${known}` : ""}`);
  }
  let sectionNodes = neighborhoodFrom(sourceNodes, hitHeading.tapeIndex);
  if (step.includeHeading === false) {
    sectionNodes = sectionNodes.slice(1);
    if (sectionNodes.length === 0) {
      throw new Error(`steps[${stepIndex}] sectionCopy: source section "${fromSection}" has no body content to copy`);
    }
  }
  const exp = exportDocumentToMarkdown([
    { nodes: sectionNodes, tabId: sourceTabId, tabTitle: resolvedSourceTab.title }
  ]);
  const markdown = exp.markdown.trim();
  const mutation = {};
  if (step.nodeAfter != null) {
    mutation.after = runtime.aliasResolve(step.nodeAfter);
    mutation.insertMarkdown = markdown;
  } else if (step.nodeBefore != null) {
    mutation.before = runtime.aliasResolve(step.nodeBefore);
    mutation.insertMarkdown = markdown;
  } else {
    const at2 = step.nodeAt ?? fromSection;
    mutation.at = runtime.aliasResolve(at2);
    mutation.replaceSection = markdown;
  }
  await surgicalMutationExecute(runtime, step, mutation);
};

// src/core/actions/surgical.ts
var surgicalStep = async (runtime, _stepIndex, step) => {
  await surgicalMutationExecute(runtime, step, domOpFromStep(step, runtime.aliasResolve));
};

// src/core/actions/tabCreate.ts
var tabCreateStep = async (runtime, stepIndex, step) => {
  const as = step.as;
  if (!as)
    throw new Error(`steps[${stepIndex}] tabCreate requires "as: <alias>"`);
  const title = step.title;
  if (!title)
    throw new Error(`steps[${stepIndex}] tabCreate requires title: <string>`);
  if (step.doc) {
    await pendingWritersFlush(runtime, step.doc);
  }
  const targetDoc = runtime.openDocResolve(step.doc);
  const existingFlat = flattenTabs(targetDoc.gdoc.data.tabs);
  if (existingFlat.some((t) => t.title.trim().toLowerCase() === title.trim().toLowerCase())) {
    throw new Error(`Tab title "${title}" already exists in document "${targetDoc.alias}". Tab titles must be unique.`);
  }
  const targetIndex = resolveRelativeTabIndex(targetDoc.gdoc.data, {
    afterTab: step.afterTab,
    beforeTab: step.beforeTab,
    index: step.index
  });
  const fromTabHint = step.fromTab ? runtime.aliasResolve(step.fromTab) : undefined;
  let newTabId = `virtual:tab_${as}_${runtime.stepsExecuted}`;
  if (fromTabHint) {
    const sourceDocRef = step.fromDoc ? runtime.aliasResolve(step.fromDoc) : undefined;
    const sourceDoc = sourceDocRef ? runtime.openDocResolve(sourceDocRef) : targetDoc;
    const resolvedSourceTab = sourceDoc.gdoc.data.tabs?.length ? resolveTab(sourceDoc.gdoc.data, fromTabHint) : { tabId: "t.0", title: sourceDoc.title };
    const sourceTabId = resolvedSourceTab.tabId;
    if (!sourceTabId) {
      throw new Error(`steps[${stepIndex}] tabCreate could not resolve source tab "${fromTabHint}"`);
    }
    const force = runtime.force || Boolean(step.force);
    const sourceSimulated = simulatedNodesOf(sourceDoc.gdoc, sourceTabId);
    const parsedSource = sourceSimulated ? { nodes: sourceSimulated } : parseDocument(sourceDoc.gdoc.withTab(sourceTabId));
    const lossyScan = detectLossyTabElements(parsedSource.nodes);
    if (lossyScan.details.length > 0 && !force) {
      throw new Error(lossyTabCopyError(stepIndex, resolvedSourceTab.title ?? fromTabHint, lossyScan));
    }
    const copyWarnings = [...lossyScan.details];
    if (runtime.dryRun || targetDoc.docId.startsWith("virtual:")) {
      const existingTabs = targetDoc.gdoc.data.tabs?.length ? targetDoc.gdoc.data.tabs : [
        {
          documentTab: { body: targetDoc.gdoc.data.body },
          tabProperties: { index: 0, tabId: "t.0", title: "Main" }
        }
      ];
      const sourceDocTab = sourceDoc.gdoc.data.tabs?.length ? findTab(sourceDoc.gdoc.data.tabs, sourceTabId) : null;
      const sourceBody = sourceDocTab?.documentTab?.body ?? targetDoc.gdoc.data.body;
      const newDocTab = {
        documentTab: {
          body: structuredClone(sourceBody)
        },
        tabProperties: {
          index: targetIndex ?? existingTabs.length,
          tabId: newTabId,
          title
        }
      };
      const existingSim = targetDoc.gdoc;
      const simNodes = existingSim.simulatedNodes;
      const simTabs = existingSim.simulatedTabs;
      const nextTabs = [...existingTabs];
      if (targetIndex != null && Number.isInteger(targetIndex)) {
        const clampedIdx = Math.max(0, Math.min(targetIndex, nextTabs.length));
        nextTabs.splice(clampedIdx, 0, newDocTab);
      } else {
        nextTabs.push(newDocTab);
      }
      targetDoc.gdoc = new Gdoc({
        ...targetDoc.gdoc.data,
        tabs: nextTabs
      }, targetDoc.docId);
      if (simNodes)
        targetDoc.gdoc.simulatedNodes = simNodes;
      if (simTabs)
        targetDoc.gdoc.simulatedTabs = simTabs;
      simulatedNodesSet(targetDoc.gdoc, structuredClone(sourceSimulated ?? parsedSource.nodes), newTabId);
    } else {
      const req = RequestBuilder.addDocumentTab(title, { index: targetIndex });
      const resStr = await runtime.client.batchUpdate(targetDoc.docId, [req]);
      const res = JSON.parse(resStr || "{}");
      const createdTabId = res.replies?.[0]?.addDocumentTab?.tabProperties?.tabId;
      if (!createdTabId) {
        throw new Error(`steps[${stepIndex}] tabCreate: addDocumentTab reply did not include created tabId`);
      }
      newTabId = createdTabId;
      const specs = parsedSource.nodes.filter((n) => n.kind !== "sectionBreak").map((n) => {
        const spec = elementSpecFromNode(n);
        if ("warnings" in spec && Array.isArray(spec.warnings)) {
          copyWarnings.push(...spec.warnings);
        }
        return spec;
      });
      if (specs.length > 0) {
        await elementsInsertExecute({
          client: runtime.client,
          documentId: targetDoc.docId,
          elements: specs,
          force,
          tabHint: newTabId
        });
      }
      targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
    }
    if (runtime.dryRun) {
      const key = `${targetDoc.alias}/${newTabId}`;
      if (!runtime.initialMarkdownStates.has(key)) {
        runtime.initialMarkdownStates.set(key, "");
      }
    }
    runtime.aliasMap.set(as, newTabId);
    const dumpPayload = {
      alias: as,
      id: newTabId,
      kind: "tab",
      title,
      ...copyWarnings.length > 0 ? { warnings: Array.from(new Set(copyWarnings)) } : {}
    };
    runtime.dumpStore.set(as, dumpPayload);
    if (step.dump) {
      runtime.dumped[as] = dumpPayload;
    }
  } else {
    if (!runtime.dryRun) {
      const req = RequestBuilder.addDocumentTab(title, { index: targetIndex });
      const resStr = await runtime.client.batchUpdate(targetDoc.docId, [req]);
      const res = JSON.parse(resStr || "{}");
      const createdTabId = res.replies?.[0]?.addDocumentTab?.tabProperties?.tabId;
      if (!createdTabId) {
        throw new Error(`steps[${stepIndex}] tabCreate: addDocumentTab reply did not include created tabId`);
      }
      newTabId = createdTabId;
      targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
    } else {
      const existingTabs = targetDoc.gdoc.data.tabs?.length ? targetDoc.gdoc.data.tabs : [
        {
          documentTab: { body: targetDoc.gdoc.data.body },
          tabProperties: { index: 0, tabId: "t.0", title: "Main" }
        }
      ];
      const newDocTab = {
        documentTab: {
          body: {
            content: [
              { endIndex: 1, sectionBreak: {}, startIndex: 0 },
              {
                endIndex: 2,
                paragraph: { elements: [{ textRun: { content: `
` } }] },
                startIndex: 1
              }
            ]
          }
        },
        tabProperties: {
          index: targetIndex ?? existingTabs.length,
          tabId: newTabId,
          title
        }
      };
      const existingSim = targetDoc.gdoc;
      const simNodes = existingSim.simulatedNodes;
      const simTabs = existingSim.simulatedTabs;
      const nextTabs = [...existingTabs];
      if (targetIndex != null && Number.isInteger(targetIndex)) {
        const clampedIdx = Math.max(0, Math.min(targetIndex, nextTabs.length));
        nextTabs.splice(clampedIdx, 0, newDocTab);
      } else {
        nextTabs.push(newDocTab);
      }
      targetDoc.gdoc = new Gdoc({
        ...targetDoc.gdoc.data,
        tabs: nextTabs
      }, targetDoc.docId);
      if (simNodes)
        targetDoc.gdoc.simulatedNodes = simNodes;
      if (simTabs)
        targetDoc.gdoc.simulatedTabs = simTabs;
    }
    if (runtime.dryRun) {
      const key = `${targetDoc.alias}/${newTabId}`;
      if (!runtime.initialMarkdownStates.has(key)) {
        runtime.initialMarkdownStates.set(key, "");
      }
    }
    runtime.aliasMap.set(as, newTabId);
    const dumpPayload = {
      alias: as,
      id: newTabId,
      kind: "tab",
      title
    };
    runtime.dumpStore.set(as, dumpPayload);
    if (step.dump) {
      runtime.dumped[as] = dumpPayload;
    }
  }
  let highlight = runtime.createdHighlights.get(targetDoc.alias);
  if (!highlight) {
    highlight = {
      as: targetDoc.alias,
      id: targetDoc.docId,
      tabs: [],
      title: targetDoc.title
    };
    runtime.createdHighlights.set(targetDoc.alias, highlight);
  }
  if (!highlight.tabs)
    highlight.tabs = [];
  highlight.tabs.push({
    as,
    id: newTabId,
    title
  });
  runtime.stepsExecuted++;
};
function detectLossyTabElements(nodes) {
  const counts = {
    chipTitles: [],
    equations: 0,
    footnotes: 0,
    horizontalRules: 0,
    images: 0,
    toc: 0
  };
  const details = [];
  for (const node of nodes) {
    const msgs = unclonableFromNode(node);
    details.push(...msgs);
    for (const msg of msgs) {
      const chip = msg.match(/(?:person chip|date chip|rich link chip|unsupported smart chip) "([^"]*)"/);
      if (chip)
        counts.chipTitles.push(chip[1] || "chip");
      else if (msg.includes("inline image"))
        counts.images++;
      else if (msg.includes("math equation"))
        counts.equations++;
      else if (msg.includes("footnote"))
        counts.footnotes++;
      else if (msg.includes("Table of Contents"))
        counts.toc++;
      else if (msg.includes("horizontal rule"))
        counts.horizontalRules++;
    }
  }
  return { details, summary: lossyTabScanSummary(counts, details.length) };
}
function lossyTabCopyError(stepIndex, sourceTitle, scan) {
  const issueList = scan.details.map((msg) => `  • ${msg}`).join(`
`);
  return `steps[${stepIndex}] tabCreate: cannot copy tab "${sourceTitle}" losslessly (${scan.summary}). Use the Google Docs UI (right-click the tab > Duplicate) or pass force: true for lossy conversion.
` + `${issueList}

` + `Google Docs REST API has no native tab duplication endpoint. Person, date, and rich-link chips and public https images are reconstructed; Drive-only images, footnotes, equations, unsupported chips, TOC, and horizontal rules cannot.`;
}
function lossyTabScanSummary(counts, detailCount) {
  const parts = [];
  if (counts.chipTitles.length > 0) {
    const titles = counts.chipTitles.map((t) => `"${t}"`).join(", ");
    parts.push(`${counts.chipTitles.length} smart chip(s): ${titles}`);
  }
  if (counts.images > 0)
    parts.push(`${counts.images} inline image(s)`);
  if (counts.equations > 0)
    parts.push(`${counts.equations} math equation(s)`);
  if (counts.footnotes > 0)
    parts.push(`${counts.footnotes} footnote(s)`);
  if (counts.horizontalRules > 0)
    parts.push(`${counts.horizontalRules} horizontal rule(s)`);
  if (counts.toc > 0)
    parts.push(`${counts.toc} table of contents`);
  if (parts.length === 0 && detailCount > 0)
    parts.push(`${detailCount} uncreatable element(s)`);
  return parts.join("; ");
}

// src/core/actions/tabDelete.ts
var tabDeleteStep = async (runtime, stepIndex, step) => {
  if (step.doc) {
    await pendingWritersFlush(runtime, step.doc);
  }
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  if (!tabHint)
    throw new Error(`steps[${stepIndex}] tabDelete requires tab: <id|title>`);
  const resolved = targetDoc.gdoc.data.tabs?.length ? resolveTab(targetDoc.gdoc.data, tabHint) : { tabId: undefined, title: targetDoc.title };
  if (!resolved.tabId) {
    throw new Error(`Cannot delete tab "${tabHint}": resolved tab has no tabId`);
  }
  const flatTabs = flattenTabs(targetDoc.gdoc.data.tabs);
  const tabsRemaining = flatTabs.filter((t) => t.tabId !== resolved.tabId);
  if (tabsRemaining.length === 0) {
    throw new Error(`Cannot delete tab "${tabHint}": document "${targetDoc.alias}" only has one tab. Google Docs requires at least one tab.`);
  }
  if (!runtime.dryRun && !targetDoc.docId.startsWith("virtual:")) {
    const req = RequestBuilder.deleteTab(resolved.tabId);
    await runtime.client.batchUpdate(targetDoc.docId, [req]);
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
  } else {
    const tabs = targetDoc.gdoc.data.tabs ? [...targetDoc.gdoc.data.tabs] : [];
    const fromIdx = tabs.findIndex((t) => t.tabProperties?.tabId === resolved.tabId);
    if (fromIdx >= 0) {
      tabs.splice(fromIdx, 1);
      targetDoc.gdoc = new Gdoc({ ...targetDoc.gdoc.data, tabs }, targetDoc.docId);
    }
    const sim = targetDoc.gdoc;
    sim.simulatedTabs?.delete(resolved.tabId);
    for (const key of [...runtime.initialMarkdownStates.keys()]) {
      if (key.startsWith(`${targetDoc.alias}/${resolved.tabId}`)) {
        runtime.initialMarkdownStates.delete(key);
      }
    }
  }
  runtime.stepsExecuted++;
};

// src/core/actions/tabMove.ts
var tabMoveStep = async (runtime, stepIndex, step) => {
  if (step.noop) {
    runtime.stepsExecuted++;
    return;
  }
  if (step.doc) {
    await pendingWritersFlush(runtime, step.doc);
  }
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  if (!tabHint) {
    throw new Error(`steps[${stepIndex}] ${step.kind ?? "tabMove"} requires tab: <id|title>`);
  }
  const resolved = targetDoc.gdoc.data.tabs?.length ? resolveTab(targetDoc.gdoc.data, tabHint) : { tabId: undefined, title: targetDoc.title };
  if (!resolved.tabId) {
    throw new Error(`Cannot move tab "${tabHint}": resolved tab has no tabId`);
  }
  const targetIndex = resolveRelativeTabIndex(targetDoc.gdoc.data, {
    afterTab: step.afterTab,
    beforeTab: step.beforeTab,
    index: step.index,
    movingTabId: resolved.tabId
  });
  if (targetIndex == null || !Number.isInteger(targetIndex) || targetIndex < 0) {
    throw new Error(`steps[${stepIndex}] ${step.kind ?? "tabMove"} requires index, afterTab, or beforeTab`);
  }
  const existingFlat = flattenTabs(targetDoc.gdoc.data.tabs);
  const currentIdx = existingFlat.findIndex((t) => t.tabId === resolved.tabId);
  if (currentIdx === targetIndex) {
    runtime.stepsExecuted++;
    return;
  }
  if (!runtime.dryRun && !targetDoc.docId.startsWith("virtual:")) {
    const req = RequestBuilder.moveTab(resolved.tabId, targetIndex);
    try {
      await runtime.client.batchUpdate(targetDoc.docId, [req]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const hasRootTab = targetDoc.gdoc.data.tabs?.some((t) => t.tabProperties?.tabId === "t.0");
      if (!hasRootTab && errMsg.includes("500")) {
        throw new Error(`Google Docs API failed to move tab with HTTP 500 Internal error.
` + `This is a known Google Docs API upstream bug when documents lack a root "t.0" tab (common in documents copied from multi-tab templates).
` + `To position tabs without relying on tabMove, specify index: <n> directly during tab creation:
` + `  { kind: "tabCreate", doc: "${targetDoc.alias}", as: "my_tab", fromTab: "${resolved.tabId}", title: "${resolved.title}", index: ${targetIndex} }
` + `or
` + `  { kind: "tabCreate", doc: "${targetDoc.alias}", as: "my_tab", title: "${resolved.title}", index: ${targetIndex} }`);
      }
      throw err;
    }
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
  } else {
    const tabs = targetDoc.gdoc.data.tabs ? [...targetDoc.gdoc.data.tabs] : [];
    const fromIdx = tabs.findIndex((t) => t.tabProperties?.tabId === resolved.tabId);
    if (fromIdx >= 0) {
      const [moved] = tabs.splice(fromIdx, 1);
      if (moved) {
        const destIdx = Math.max(0, Math.min(targetIndex, tabs.length));
        tabs.splice(destIdx, 0, moved);
      }
      targetDoc.gdoc = new Gdoc({
        ...targetDoc.gdoc.data,
        tabs
      }, targetDoc.docId);
    }
  }
  runtime.stepsExecuted++;
};

// src/core/actions/tabRename.ts
var tabRenameStep = async (runtime, stepIndex, step) => {
  if (step.noop) {
    runtime.stepsExecuted++;
    return;
  }
  if (step.doc) {
    await pendingWritersFlush(runtime, step.doc);
  }
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  if (!tabHint)
    throw new Error(`steps[${stepIndex}] tabRename requires tab: <id|title>`);
  const title = step.title;
  if (!title)
    throw new Error(`steps[${stepIndex}] tabRename requires title: <string>`);
  const resolved = resolveTab(targetDoc.gdoc.data, tabHint);
  if (!resolved.tabId) {
    throw new Error(`Cannot rename tab "${tabHint}": resolved tab has no tabId`);
  }
  if (resolved.title === title) {
    runtime.stepsExecuted++;
    return;
  }
  const existingTabs = flattenTabs(targetDoc.gdoc.data.tabs);
  const otherTabs = existingTabs.filter((t) => t.tabId !== resolved.tabId);
  if (otherTabs.some((t) => t.title.trim().toLowerCase() === title.trim().toLowerCase())) {
    throw new Error(`Tab title "${title}" already exists in document "${targetDoc.alias}". Tab titles must be unique.`);
  }
  if (!runtime.dryRun) {
    const req = RequestBuilder.renameTab(resolved.tabId, title);
    try {
      await runtime.client.batchUpdate(targetDoc.docId, [req]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const hasRootTab = targetDoc.gdoc.data.tabs?.some((t) => t.tabProperties?.tabId === "t.0");
      if (!hasRootTab && errMsg.includes("500")) {
        throw new Error(`Google Docs API failed to rename tab with HTTP 500 Internal error.
` + `This is a known upstream Google Docs API bug when documents lack a root "t.0" tab (common in documents copied from multi-tab templates).
` + `Existing tabs must be renamed in the Google Docs web UI. For newly added tabs, specify the final title directly during creation:
` + `  { kind: "tabCreate", doc: "${targetDoc.alias}", as: "my_tab", fromTab: "${resolved.tabId}", title: "${title}" }
` + `or
` + `  { kind: "tabCreate", doc: "${targetDoc.alias}", as: "my_tab", title: "${title}" }`);
      }
      throw err;
    }
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
  } else {
    if (targetDoc.gdoc.data.tabs?.length) {
      const tab = findTab(targetDoc.gdoc.data.tabs, resolved.tabId);
      if (tab?.tabProperties) {
        tab.tabProperties.title = title;
      }
    }
  }
  runtime.stepsExecuted++;
};

// src/core/replace.ts
var MULTI_TAB_REPLACE_REQUIRED_MSG = "This Doc has multiple tabs. Specify --tab <id|title> to target a single tab, or --all-tabs to replace across the entire document.";
function globalRegexCreate(pattern, ignoreCase = false) {
  if (pattern instanceof RegExp) {
    let flags2 = pattern.flags;
    if (!flags2.includes("g"))
      flags2 += "g";
    if (ignoreCase && !flags2.includes("i"))
      flags2 += "i";
    return new RegExp(pattern.source, flags2);
  }
  const str = String(pattern);
  const match = /^\/(.*)\/([a-z]*)$/.exec(str);
  if (match) {
    const rawPattern = match[1];
    let flags2 = match[2];
    if (!flags2.includes("g"))
      flags2 += "g";
    if (ignoreCase && !flags2.includes("i"))
      flags2 += "i";
    return new RegExp(rawPattern, flags2);
  }
  const flags = ignoreCase ? "gi" : "g";
  return new RegExp(str, flags);
}
var createGlobalRegex = globalRegexCreate;
function hasRegexMatch(str, regex2) {
  const clone = new RegExp(regex2.source, regex2.flags);
  return clone.test(str);
}
async function batchReplaceExecute(documentId, options) {
  const client = options.client ?? gws;
  const matchCase = options.matchCase ?? true;
  const replacements = options.replacements;
  if (!replacements || replacements.length === 0) {
    throw new Error("No replacements provided.");
  }
  for (const r of replacements) {
    if (!r.find) {
      throw new Error("Find string cannot be empty.");
    }
  }
  const freshDoc = await Gdoc.load(documentId, client);
  const flatTabs = flattenTabs(freshDoc.data.tabs);
  let tabId;
  let tabTitle;
  const allTabs = Boolean(options.allTabs);
  if (allTabs) {
    tabId = undefined;
  } else if (options.tabHint && freshDoc.data.tabs?.length) {
    const resolved = resolveTab(freshDoc.data, options.tabHint);
    tabId = resolved.tabId;
    tabTitle = resolved.title;
  } else {
    if (flatTabs.length > 1) {
      throw new Error(MULTI_TAB_REPLACE_REQUIRED_MSG);
    }
    if (flatTabs.length === 1) {
      tabId = flatTabs[0]?.tabId;
      tabTitle = flatTabs[0]?.title;
    }
  }
  if (options.dryRun) {
    const texts = collectTargetTexts(freshDoc, { allTabs, flatTabs, tabId });
    const results2 = replacements.map((pair) => {
      const { count, snippets } = countAndSampleMatches(texts, pair.find, matchCase);
      return {
        find: pair.find,
        occurrences: count,
        replace: pair.replace,
        ...snippets.length > 0 ? { snippets } : {}
      };
    });
    const totalOccurrences = results2.reduce((acc, r) => acc + r.occurrences, 0);
    const touchedNodeIds2 = collectTouchedNodeIds(freshDoc, {
      allTabs,
      finds: replacements.map((r) => r.find),
      flatTabs,
      matchCase,
      tabId
    });
    return {
      allTabs: allTabs ? true : undefined,
      documentId,
      dryRun: true,
      matchCase,
      occurrencesChanged: totalOccurrences,
      replacements: results2,
      tabId,
      tabTitle,
      ...touchedNodeIds2.length ? { touchedNodeIds: touchedNodeIds2 } : {}
    };
  }
  await DriveRevisions.pinHead(documentId, client);
  const tabIds = tabId ? [tabId] : undefined;
  const requests = replacements.map((pair) => RequestBuilder.replaceAllText(pair.find, pair.replace, {
    matchCase,
    tabIds
  }));
  const resText = await client.batchUpdate(documentId, requests);
  docCache.invalidate(documentId);
  let parsedRes = {};
  try {
    parsedRes = JSON.parse(resText);
  } catch {}
  const replies = parsedRes.replies ?? [];
  const results = replacements.map((pair, idx) => {
    const occurrences = replies[idx]?.replaceAllText?.occurrencesChanged ?? 0;
    return {
      find: pair.find,
      occurrences,
      replace: pair.replace
    };
  });
  const totalChanged = results.reduce((acc, r) => acc + r.occurrences, 0);
  const touchedNodeIds = collectTouchedNodeIds(freshDoc, {
    allTabs,
    finds: replacements.map((r) => r.find),
    flatTabs,
    matchCase,
    tabId
  });
  return {
    allTabs: allTabs ? true : undefined,
    documentId,
    dryRun: false,
    matchCase,
    occurrencesChanged: totalChanged,
    replacements: results,
    tabId,
    tabTitle,
    ...touchedNodeIds.length ? { touchedNodeIds } : {}
  };
}
async function regexReplaceExecute(documentId, options) {
  const client = options.client ?? gws;
  const ignoreCase = Boolean(options.ignoreCase);
  if (options.regex == null || options.regex === "") {
    throw new Error("Regex pattern cannot be empty.");
  }
  if (options.replace == null) {
    throw new Error("Replacement string is required.");
  }
  if (options.allTabs && options.at != null) {
    throw new Error("Cannot combine --at with --all-tabs.");
  }
  let re;
  try {
    re = createGlobalRegex(options.regex, ignoreCase);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid regular expression "${options.regex}": ${msg}`);
  }
  const freshDoc = await Gdoc.load(documentId, client);
  const flatTabs = flattenTabs(freshDoc.data.tabs);
  const targets = [];
  let tabIdSummary;
  let tabTitleSummary;
  if (options.allTabs) {
    if (flatTabs.length === 0) {
      targets.push({});
    } else {
      for (const t of flatTabs) {
        targets.push({ tabId: t.tabId, title: t.title });
      }
    }
  } else if (options.tabHint) {
    const resolved = resolveTab(freshDoc.data, options.tabHint);
    targets.push({ tabId: resolved.tabId, title: resolved.title });
    tabIdSummary = resolved.tabId;
    tabTitleSummary = resolved.title;
  } else {
    if (flatTabs.length > 1) {
      throw new Error(MULTI_TAB_REPLACE_REQUIRED_MSG);
    }
    if (flatTabs.length === 1) {
      targets.push({ tabId: flatTabs[0]?.tabId, title: flatTabs[0]?.title });
      tabIdSummary = flatTabs[0]?.tabId;
      tabTitleSummary = flatTabs[0]?.title;
    } else {
      targets.push({});
    }
  }
  const allMatches = [];
  const writers = [];
  const plans = [];
  let totalOccurrences = 0;
  for (const target of targets) {
    const tabDoc = target.tabId ? freshDoc.withTab(target.tabId) : freshDoc;
    const parsed = parseDocument(tabDoc);
    const tabOps = [];
    const at2 = options.at;
    const atDest = at2 != null ? parseWriteAt(at2) : undefined;
    if (atDest?.cell && at2 != null) {
      const { cell, nodeId, para } = atDest;
      const tableNode = parsed.nodes.find((n) => n.tapeIndex === nodeId);
      if (tableNode?.kind !== "table" || !tableNode.table?.cells) {
        throw new Error(`Table node ${nodeId} not found for cell "${options.at}".`);
      }
      const [r, c] = cell ?? [0, 0];
      const tableRow = tableNode.table.cells[r];
      const tableCell = tableRow ? tableRow[c] : undefined;
      if (!tableCell) {
        throw new Error(`Cell "${options.at}" not found in table ${nodeId}.`);
      }
      const pIdx = para ?? 0;
      const p = tableCell.paragraphs?.[pIdx] ? tableCell.paragraphs[pIdx] : tableCell;
      const markup = p.markup;
      const plain = p.text ?? "";
      const source = markup && hasRegexMatch(markup, re) ? markup : plain;
      if (hasRegexMatch(source, re)) {
        const matches = [...source.matchAll(new RegExp(re.source, re.flags))];
        const count = matches.length;
        re.lastIndex = 0;
        const replaced = source.replace(re, options.replace);
        const emitAt = "scopedId" in p && p.scopedId || tableCell.scopedId || at2;
        tabOps.push({ at: emitAt, innerText: replaced });
        allMatches.push({
          after: replaced,
          at: emitAt,
          before: source,
          occurrences: count
        });
        totalOccurrences += count;
      }
    } else {
      let targetNodes;
      if (options.at != null) {
        const hit = findNodeAt(parsed.nodes, options.at);
        if (!hit) {
          throw new Error(missingNodeIdMsg(options.at, parsed.nodes.length));
        }
        if (options.nodeOnly) {
          targetNodes = [hit];
        } else {
          targetNodes = neighborhoodFrom(parsed.nodes, options.at);
        }
      } else {
        targetNodes = parsed.nodes;
      }
      for (const node of targetNodes) {
        if (node.kind === "paragraph") {
          const markup = node.markup;
          const plain = node.text ?? "";
          const source = markup && hasRegexMatch(markup, re) ? markup : plain;
          if (hasRegexMatch(source, re)) {
            const matches = [...source.matchAll(new RegExp(re.source, re.flags))];
            const count = matches.length;
            re.lastIndex = 0;
            const replaced = source.replace(re, options.replace);
            tabOps.push({ at: node.scopedId ?? node.tapeIndex, innerText: replaced });
            allMatches.push({
              after: replaced,
              at: node.scopedId ?? node.tapeIndex,
              before: source,
              occurrences: count
            });
            totalOccurrences += count;
          }
        } else if (node.kind === "table" && node.table?.cells) {
          for (let r = 0;r < node.table.cells.length; r++) {
            const row = node.table.cells[r];
            for (let c = 0;c < row.length; c++) {
              const cell = row[c];
              if (cell.paragraphs && cell.paragraphs.length > 0) {
                for (let p = 0;p < cell.paragraphs.length; p++) {
                  const cp = cell.paragraphs[p];
                  const targetAt = cp.scopedId ?? cell.scopedId ?? cellId(node.tapeIndex, r, c, p);
                  const markup = cp.markup;
                  const plain = cp.text ?? "";
                  const source = markup && hasRegexMatch(markup, re) ? markup : plain;
                  if (hasRegexMatch(source, re)) {
                    const matches = [...source.matchAll(new RegExp(re.source, re.flags))];
                    const count = matches.length;
                    re.lastIndex = 0;
                    const replaced = source.replace(re, options.replace);
                    tabOps.push({ at: targetAt, innerText: replaced });
                    allMatches.push({
                      after: replaced,
                      at: targetAt,
                      before: source,
                      occurrences: count
                    });
                    totalOccurrences += count;
                  }
                }
              } else {
                const targetAt = cell.scopedId ?? cellId(node.tapeIndex, r, c, 0);
                const markup = cell.markup;
                const plain = cell.text ?? "";
                const source = markup && hasRegexMatch(markup, re) ? markup : plain;
                if (hasRegexMatch(source, re)) {
                  const matches = [...source.matchAll(new RegExp(re.source, re.flags))];
                  const count = matches.length;
                  re.lastIndex = 0;
                  const replaced = source.replace(re, options.replace);
                  tabOps.push({ at: targetAt, innerText: replaced });
                  allMatches.push({
                    after: replaced,
                    at: targetAt,
                    before: source,
                    occurrences: count
                  });
                  totalOccurrences += count;
                }
              }
            }
          }
        }
      }
    }
    if (tabOps.length > 0) {
      const writer = new DomWriter(parsed.nodes, {
        force: options.force,
        lists: tabDoc.data.lists,
        tabId: target.tabId
      });
      const plan = applyOps(writer, tabOps);
      writers.push(writer);
      plans.push(...plan);
    }
  }
  const touchedFromMatches = uniqueMatchIds(allMatches);
  if (options.dryRun || totalOccurrences === 0) {
    return {
      allTabs: options.allTabs ? true : undefined,
      at: options.at,
      documentId,
      dryRun: Boolean(options.dryRun),
      matches: allMatches,
      occurrencesChanged: totalOccurrences,
      pattern: re.source,
      replace: options.replace,
      tabId: tabIdSummary,
      tabTitle: tabTitleSummary,
      ...touchedFromMatches.length ? { touchedNodeIds: touchedFromMatches } : {}
    };
  }
  await DriveRevisions.pinHead(documentId, client);
  await applyDom(documentId, writers, {
    client,
    doc: freshDoc.data,
    force: options.force,
    plan: plans
  });
  docCache.invalidate(documentId);
  return {
    allTabs: options.allTabs ? true : undefined,
    at: options.at,
    documentId,
    dryRun: false,
    matches: allMatches,
    occurrencesChanged: totalOccurrences,
    pattern: re.source,
    replace: options.replace,
    tabId: tabIdSummary,
    tabTitle: tabTitleSummary,
    ...touchedFromMatches.length ? { touchedNodeIds: touchedFromMatches } : {}
  };
}
function collectTouchedNodeIds(gdoc, target) {
  const ids = [];
  const seen = new Set;
  const visit = (parsed) => {
    for (const n of parsed.nodes) {
      if (!nodeMatchesFinds(n, target.finds, target.matchCase))
        continue;
      const key = String(n.tapeIndex);
      if (seen.has(key))
        continue;
      seen.add(key);
      ids.push(n.tapeIndex);
    }
  };
  if (target.allTabs && target.flatTabs.length > 0) {
    for (const t of target.flatTabs) {
      visit(parseDocument(gdoc.withTab(t.tabId)));
    }
  } else if (target.tabId) {
    visit(parseDocument(gdoc.withTab(target.tabId)));
  } else {
    visit(parseDocument(gdoc));
  }
  return ids;
}
function nodeMatchesFinds(node, finds, matchCase) {
  const hay = node.text ?? "";
  const markup = node.markup ?? "";
  for (const find of finds) {
    if (!find)
      continue;
    if (containsText(hay, find, matchCase) || containsText(markup, find, matchCase)) {
      return true;
    }
    if (node.table?.cells) {
      for (const row of node.table.cells) {
        for (const cell of row) {
          if (containsText(cell.text ?? "", find, matchCase) || containsText(cell.markup ?? "", find, matchCase)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}
function containsText(hay, needle, matchCase) {
  if (!needle)
    return false;
  if (matchCase)
    return hay.includes(needle);
  return hay.toLowerCase().includes(needle.toLowerCase());
}
function uniqueMatchIds(matches) {
  const ids = [];
  const seen = new Set;
  for (const m2 of matches) {
    const key = String(m2.at);
    if (seen.has(key))
      continue;
    seen.add(key);
    ids.push(m2.at);
  }
  return ids;
}
function collectTargetTexts(gdoc, target) {
  const texts = [];
  if (target.allTabs && target.flatTabs.length > 0) {
    for (const t of target.flatTabs) {
      const tabDoc = gdoc.withTab(t.tabId);
      const parsed = parseDocument(tabDoc);
      texts.push(...extractDocumentTexts(parsed));
    }
  } else if (target.tabId) {
    const tabDoc = gdoc.withTab(target.tabId);
    const parsed = parseDocument(tabDoc);
    texts.push(...extractDocumentTexts(parsed));
  } else {
    const parsed = parseDocument(gdoc);
    texts.push(...extractDocumentTexts(parsed));
  }
  return texts;
}
function extractDocumentTexts(parsed) {
  const texts = [];
  function addNode(n) {
    if (n.text)
      texts.push(n.text);
    if (n.table?.cells) {
      for (const row of n.table.cells) {
        for (const cell of row) {
          if (cell.text)
            texts.push(cell.text);
          if (cell.paragraphs) {
            for (const p of cell.paragraphs) {
              if (p.text)
                texts.push(p.text);
            }
          }
        }
      }
    }
  }
  for (const n of parsed.nodes)
    addNode(n);
  for (const s of parsed.segments) {
    for (const n of s.nodes)
      addNode(n);
  }
  return texts;
}
function countAndSampleMatches(texts, findText, matchCase, maxSnippets = 3) {
  if (!findText)
    return { count: 0, snippets: [] };
  let count = 0;
  const snippets = [];
  const query = matchCase ? findText : findText.toLowerCase();
  for (const text of texts) {
    const hay = matchCase ? text : text.toLowerCase();
    let idx = hay.indexOf(query, 0);
    while (idx !== -1) {
      count++;
      if (snippets.length < maxSnippets) {
        snippets.push(extractSnippet(text, idx, findText.length));
      }
      idx = hay.indexOf(query, idx + findText.length);
    }
  }
  return { count, snippets };
}
function extractSnippet(text, matchIdx, matchLen) {
  const start = Math.max(0, matchIdx - 25);
  const end = Math.min(text.length, matchIdx + matchLen + 25);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  const rawSnippet = text.slice(start, end).replace(/\r?\n/g, " ");
  return `${prefix}${rawSnippet}${suffix}`;
}

// src/core/actions/textReplace.ts
var textReplaceStep = async (runtime, _stepIndex, step) => {
  const targetDoc = runtime.openDocResolve(step.doc);
  const tabHint = runtime.aliasResolve(step.tab);
  const hasAnchor = step.nodeAt != null || step.nodeAfter != null || step.nodeBefore != null || step.nodeUnder != null;
  const scopedFindAnchor = step.nodeAt ?? step.nodeUnder;
  if (step.find != null && scopedFindAnchor != null) {
    const replaceStr = step.replace ?? step.text ?? "";
    const tabResolution = targetDoc.gdoc.data.tabs?.length && tabHint ? resolveTab(targetDoc.gdoc.data, tabHint) : undefined;
    const targetTabId = tabResolution?.tabId;
    const anchorResolved = runtime.aliasResolve(scopedFindAnchor);
    if (anchorResolved == null) {
      throw new Error(`textReplace could not resolve anchor "${scopedFindAnchor}"`);
    }
    const nodeOnly = step.nodeAt != null;
    if (runtime.dryRun || targetDoc.docId.startsWith("virtual:")) {
      const gdoc = targetTabId ? targetDoc.gdoc.withTab(targetTabId) : targetDoc.gdoc;
      const simulated = simulatedNodesOf(targetDoc.gdoc, targetTabId);
      const nodes = simulated ?? parseDocument(gdoc).nodes;
      const targetNodes = nodeOnly ? (() => {
        const hit = findNodeAt(nodes, anchorResolved);
        return hit ? [hit] : [];
      })() : neighborhoodFrom(nodes, anchorResolved);
      if (targetNodes.length === 0) {
        throw new Error(`textReplace anchor "${anchorResolved}" did not match any nodes`);
      }
      simulatedNodesTextReplace(targetNodes, step.find, replaceStr, step.matchCase ?? true);
      if (simulated) {
        simulatedNodesSet(targetDoc.gdoc, nodes, targetTabId);
      }
      runtime.stepsExecuted++;
      return;
    }
    await pendingWritersFlush(runtime, targetDoc.alias);
    await regexReplaceExecute(targetDoc.docId, {
      at: anchorResolved,
      client: runtime.client,
      dryRun: false,
      ignoreCase: !(step.matchCase ?? true),
      nodeOnly,
      regex: escapeRegExp(step.find),
      replace: replaceStr,
      tabHint: targetTabId
    });
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
    runtime.stepsExecuted++;
    return;
  }
  if (step.find != null && !hasAnchor) {
    if (step.doc) {
      await pendingWritersFlush(runtime, step.doc);
    }
    const replaceStr = step.replace ?? step.text ?? "";
    const tabResolution = targetDoc.gdoc.data.tabs?.length && tabHint ? resolveTab(targetDoc.gdoc.data, tabHint) : undefined;
    const targetTabId = tabResolution?.tabId;
    if (runtime.dryRun || targetDoc.docId.startsWith("virtual:")) {
      gdocTextReplace(targetDoc.gdoc.data, step.find, replaceStr, targetTabId, step.matchCase ?? true);
      const simGdoc = targetDoc.gdoc;
      if (targetTabId) {
        const simulated = simulatedNodesOf(targetDoc.gdoc, targetTabId);
        if (simulated) {
          simulatedNodesTextReplace(simulated, step.find, replaceStr, step.matchCase ?? true);
        }
      } else {
        if (simGdoc.simulatedNodes) {
          simulatedNodesTextReplace(simGdoc.simulatedNodes, step.find, replaceStr, step.matchCase ?? true);
        }
        if (simGdoc.simulatedTabs) {
          for (const tabNodes of simGdoc.simulatedTabs.values()) {
            simulatedNodesTextReplace(tabNodes, step.find, replaceStr, step.matchCase ?? true);
          }
        }
      }
      runtime.stepsExecuted++;
      return;
    }
    await batchReplaceExecute(targetDoc.docId, {
      allTabs: step.allTabs ?? (!targetTabId ? true : undefined),
      client: runtime.client,
      dryRun: false,
      matchCase: step.matchCase ?? true,
      replacements: [{ find: step.find, replace: replaceStr }],
      tabHint: targetTabId
    });
    targetDoc.gdoc = await Gdoc.load(targetDoc.docId, runtime.client, { forceFetch: true });
    runtime.stepsExecuted++;
    return;
  }
  const mutation = domOpFromStep(step, runtime.aliasResolve);
  mutation.replace = step.replace ?? step.text;
  await surgicalMutationExecute(runtime, step, mutation);
};
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function gdocTextReplace(data, find, replace, tabId, matchCase = true) {
  const flags = matchCase ? "g" : "gi";
  const regex2 = new RegExp(escapeRegExp(find), flags);
  function replaceInElements(elements) {
    for (const el of elements ?? []) {
      if (el.paragraph?.elements) {
        for (const pe2 of el.paragraph.elements) {
          if (pe2.textRun?.content) {
            pe2.textRun.content = pe2.textRun.content.replace(regex2, replace);
          }
        }
      }
      if (el.table?.tableRows) {
        for (const row of el.table.tableRows) {
          for (const cell of row.tableCells ?? []) {
            replaceInElements(cell.content);
          }
        }
      }
    }
  }
  if (tabId && data.tabs?.length) {
    const tab = findTab(data.tabs, tabId);
    if (tab?.documentTab?.body?.content) {
      replaceInElements(tab.documentTab.body.content);
    }
  } else if (data.tabs?.length) {
    walkTabs(data.tabs, (t) => {
      if (t.documentTab?.body?.content) {
        replaceInElements(t.documentTab.body.content);
      }
    });
  } else if (data.body?.content) {
    replaceInElements(data.body.content);
  }
}
function simulatedNodesTextReplace(nodes, find, replace, matchCase = true) {
  const flags = matchCase ? "g" : "gi";
  const regex2 = new RegExp(escapeRegExp(find), flags);
  for (const node of nodes) {
    if (node.text) {
      node.text = node.text.replace(regex2, replace);
    }
    if (node.markup) {
      node.markup = node.markup.replace(regex2, replace);
    }
    if (node.table?.cells) {
      for (const row of node.table.cells) {
        for (const cell of row) {
          if (cell.text) {
            cell.text = cell.text.replace(regex2, replace);
          }
          if (cell.paragraphs) {
            for (const p of cell.paragraphs) {
              if (p.text) {
                p.text = p.text.replace(regex2, replace);
              }
            }
          }
        }
      }
    }
  }
}

// src/core/actions/index.ts
var STEP_HANDLERS = {
  dangerousRemoveSection: removeStep,
  docClose: closeStep,
  docCreate: docCreateStep,
  docDelete: docDeleteStep,
  docOpen: openStep,
  docPermissionAdd: docPermissionAddStep,
  docPermissionList: docPermissionListStep,
  docPermissionRemove: docPermissionRemoveStep,
  docRename: docRenameStep,
  docTrash: docTrashStep,
  innerText: innerTextStep,
  markdownInsert: markdownInsertStep,
  pageSetup: pageSetupStep,
  query: queryStep,
  remove: removeStep,
  replace: replaceStep,
  replaceMarkdown: surgicalStep,
  replaceSection: surgicalStep,
  sectionCopy: sectionCopyStep,
  surgical: surgicalStep,
  tabCreate: tabCreateStep,
  tabDelete: tabDeleteStep,
  tabMove: tabMoveStep,
  tabRename: tabRenameStep,
  tabReorder: tabMoveStep,
  textReplace: textReplaceStep
};
async function stepRun(runtime, stepIndex, step) {
  const kind = stepKindRead(step);
  if (!kind) {
    throw new Error(`steps[${stepIndex}] requires kind: <WorkflowStepKind>`);
  }
  const handler = STEP_HANDLERS[kind];
  if (!handler) {
    throw new Error(`steps[${stepIndex}] unknown kind: ${kind}`);
  }
  await handler(runtime, stepIndex, step);
}

// src/core/applyScript.ts
async function applyScriptExecute(doc, opts = {}) {
  const dryRun = Boolean(doc.dryRun);
  const force = Boolean(doc.force || opts.force);
  const client = opts.client ?? gws;
  const steps = workflowStepsOptimize(doc.steps ?? []);
  const openDocs = new Map;
  const docIdToAlias = new Map;
  const aliasMap = new Map;
  const dumpStore = new Map;
  const dumped = {};
  const initialMarkdownStates = new Map;
  const createdHighlights = new Map;
  const queryAliases = new Set;
  function aliasResolve(val) {
    if (val == null)
      return;
    const str = String(val);
    if (queryAliases.has(str)) {
      throw new Error(`Alias "${str}" is a query result. Mutations must target an explicit scopedId from the query output.`);
    }
    if (aliasMap.has(str))
      return aliasMap.get(str);
    return str.replace(/\$\{([^}]+)\}/g, (_2, key) => {
      if (queryAliases.has(key)) {
        throw new Error(`Alias "${key}" is a query result. Mutations must target an explicit scopedId from the query output.`);
      }
      return aliasMap.get(key) ?? key;
    });
  }
  function openDocResolve(rawDocRef) {
    if (rawDocRef == null || String(rawDocRef).trim() === "") {
      throw new Error("Specify doc: <alias> (open it first with kind: docOpen or docCreate)");
    }
    const str = String(rawDocRef).trim();
    const openDoc = openDocs.get(str);
    if (openDoc)
      return openDoc;
    const boundAlias = docIdToAlias.get(str) ?? Array.from(openDocs.values()).find((d2) => d2.docId === str)?.alias;
    if (boundAlias && openDocs.has(boundAlias)) {
      return openDocs.get(boundAlias);
    }
    if (/^[a-zA-Z0-9_-]{20,}$/.test(str)) {
      throw new Error(`Document ID "${str}" cannot be used directly in doc: on action steps. Open it first with { kind: "docOpen", doc: "${str}", as: "<alias>" }, then pass doc: "<alias>".`);
    }
    throw new Error(`Document "${str}" is not open or was closed`);
  }
  async function tabMarkdownCapture(ctx, tabId) {
    const currentGdoc = tabId && ctx.gdoc.data.tabs?.length ? ctx.gdoc.withTab(tabId) : ctx.gdoc;
    const parsed = parseDocument(currentGdoc);
    const exp = exportDocumentToMarkdown([{ nodes: parsed.nodes, tabId, tabTitle: parsed.title }]);
    return exp.markdown;
  }
  const preloadedDocs = new Map;
  const declaredAliases = new Set;
  for (const s of steps) {
    if (s.as)
      declaredAliases.add(s.as.trim());
  }
  const rawIdsToLoad = new Set;
  for (const step of steps) {
    if (step.kind === "docOpen" && step.doc) {
      const id = Gdoc.idParse(step.doc.trim());
      if (!id.startsWith("virtual:"))
        rawIdsToLoad.add(id);
    } else if (step.kind === "docCreate" && step.fromDoc) {
      const trimmed = step.fromDoc.trim();
      if (!declaredAliases.has(trimmed)) {
        const id = Gdoc.idParse(trimmed);
        if (!id.startsWith("virtual:"))
          rawIdsToLoad.add(id);
      }
    }
  }
  if (rawIdsToLoad.size > 0) {
    await Promise.all(Array.from(rawIdsToLoad).map(async (docId) => {
      try {
        const loaded = await Gdoc.load(docId, client);
        preloadedDocs.set(docId, loaded);
      } catch (err) {
        if (dryRun) {
          return;
        }
        throw err;
      }
    }));
  }
  const runtime = {
    activeDocAlias: undefined,
    aliasMap,
    aliasResolve,
    client,
    createdHighlights,
    docIdToAlias,
    dumpStore,
    dumped,
    dryRun,
    force,
    initialMarkdownStates,
    openDocResolve,
    openDocs,
    pageSetup: doc.pageSetup,
    preloadedDocs,
    queryAliases,
    stepsExecuted: 0,
    tabMarkdownCapture
  };
  for (let i = 0;i < steps.length; i++) {
    await stepRun(runtime, i, steps[i]);
  }
  await pendingWritersFlush(runtime);
  if (!dryRun && doc.pageSetup) {
    const ctx = (runtime.activeDocAlias ? openDocs.get(runtime.activeDocAlias) : undefined) ?? openDocs.values().next().value;
    if (ctx && !ctx.docId.startsWith("virtual:")) {
      const parsed = parseDocument(ctx.gdoc);
      const writer = new DomWriter(parsed.nodes, { lists: ctx.gdoc.data.lists });
      await applyDom(ctx.docId, writer, {
        client,
        doc: ctx.gdoc.data,
        pageSetup: doc.pageSetup
      });
      ctx.gdoc = await Gdoc.load(ctx.docId, client, { forceFetch: true });
    }
  }
  let fullDiff = "";
  if (dryRun) {
    const diffHunks = [];
    for (const [key, initialMd] of initialMarkdownStates.entries()) {
      const [alias, tabId] = key.split("/");
      const docCtx = openDocs.get(alias);
      if (!docCtx)
        continue;
      let currentMd = "";
      const simulated = simulatedNodesOf(docCtx.gdoc, tabId);
      if (simulated) {
        const exp = exportDocumentToMarkdown([{ nodes: simulated, tabId, tabTitle: docCtx.title }]);
        currentMd = exp.markdown;
      } else {
        currentMd = await tabMarkdownCapture(docCtx, tabId);
      }
      const diff = formatUnifiedDiff(initialMd, currentMd, {
        contextLines: 3,
        newPath: `b/${alias}/${tabId}`,
        oldPath: initialMd ? `a/${alias}/${tabId}` : "/dev/null"
      });
      if (diff) {
        diffHunks.push(diff);
      }
    }
    fullDiff = diffHunks.join(`

`);
  }
  for (const [alias, ctx] of openDocs.entries()) {
    const dumpedDoc = dumped[alias];
    if (dumpedDoc && dumpedDoc.kind === "doc") {
      const tabs = flattenTabs(ctx.gdoc.data.tabs);
      const tabsToCheck = tabs.length > 0 ? tabs : [{ tabId: "t.0", title: ctx.title }];
      dumpedDoc.tabs = tabsToCheck.map((t) => ({
        id: t.tabId,
        kind: "tab",
        title: t.title
      }));
    }
  }
  const highlights = Array.from(createdHighlights.values());
  return {
    diff: dryRun ? fullDiff : fullDiff || undefined,
    dumped,
    highlights,
    ok: true,
    stepsCount: runtime.stepsExecuted
  };
}
function workflowStepsOptimize(steps) {
  const createdTabs = new Map;
  for (const step of steps) {
    if (step.kind === "tabCreate" && step.title) {
      const docKey = step.doc?.trim() ?? "";
      createdTabs.set(`${docKey}:${step.title.trim().toLowerCase()}`, step);
      if (step.as) {
        createdTabs.set(`${docKey}:${step.as.trim().toLowerCase()}`, step);
      }
      continue;
    }
    if (step.kind === "tabMove" || step.kind === "tabReorder") {
      const docKey = step.doc?.trim() ?? "";
      const creator = createdTabs.get(`${docKey}:${step.tab.trim().toLowerCase()}`);
      if (creator && creator.afterTab == null && creator.beforeTab == null && creator.index == null) {
        creator.afterTab = step.afterTab;
        creator.beforeTab = step.beforeTab;
        creator.index = step.index;
        step.noop = true;
      }
      continue;
    }
    if (step.kind === "tabRename") {
      const docKey = step.doc?.trim() ?? "";
      const creator = createdTabs.get(`${docKey}:${step.tab.trim().toLowerCase()}`);
      if (creator) {
        const oldTitle = creator.title?.trim();
        const oldTitleLower = oldTitle?.toLowerCase();
        const newTitle = step.title;
        creator.title = newTitle;
        step.noop = true;
        if (oldTitle && oldTitleLower) {
          createdTabs.delete(`${docKey}:${oldTitleLower}`);
          createdTabs.set(`${docKey}:${newTitle.trim().toLowerCase()}`, creator);
          for (const s of steps) {
            if (s === step)
              break;
            const sTab = s.tab;
            if ((s.doc?.trim() ?? "") === docKey && sTab?.trim().toLowerCase() === oldTitleLower) {
              s.tab = newTitle;
            }
          }
        }
      }
    }
  }
  return steps;
}
// src/commands/run/__generated__/GdocsmithDocumentSchema.json
var GdocsmithDocumentSchema_default = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    dryRun: {
      type: "boolean",
      description: "Preview resolved targets without writing."
    },
    force: {
      type: "boolean",
      description: "Skip guards. Only if the user asked."
    },
    pageSetup: {
      $ref: "#/definitions/PageSetup",
      description: "Document paper size, margins, and layout mode (applied once on live writes)."
    },
    quiet: {
      type: "boolean",
      description: "Minimal output."
    },
    steps: {
      type: "array",
      items: {
        $ref: "#/definitions/GdocsmithStepInput"
      },
      description: "Ordered workflow steps."
    }
  },
  additionalProperties: false,
  definitions: {
    PageSetup: {
      type: "object",
      properties: {
        margins: {
          type: "object",
          properties: {
            bottom: {
              type: "number",
              description: "Bottom margin in points."
            },
            left: {
              type: "number",
              description: "Left margin in points."
            },
            right: {
              type: "number",
              description: "Right margin in points."
            },
            top: {
              type: "number",
              description: "Top margin in points."
            }
          },
          additionalProperties: false,
          description: "Page margin dimensions in points."
        },
        mode: {
          type: "string",
          enum: ["PAGES", "PAGELESS"],
          description: "Document layout mode (PAGES or PAGELESS)."
        },
        orientation: {
          type: "string",
          enum: ["LANDSCAPE", "PORTRAIT"],
          description: "Page orientation for paged documents."
        },
        pageHeight: {
          type: "number",
          description: "Custom page height in points."
        },
        pageless: {
          type: "boolean",
          description: "Whether the document is in pageless mode (convenience alias for mode: PAGELESS)."
        },
        pageSize: {
          type: "string",
          enum: ["LETTER", "LEGAL", "TABLOID", "A3", "A4", "A5", "CUSTOM"],
          description: "Standard paper size preset."
        },
        pageWidth: {
          type: "number",
          description: "Custom page width in points."
        }
      },
      additionalProperties: false,
      description: "Document page setup geometry, layout mode, and margins."
    },
    GdocsmithStepInput: {
      anyOf: [
        {
          $ref: "#/definitions/StepDocCreate"
        },
        {
          $ref: "#/definitions/StepDocLifecycle"
        },
        {
          $ref: "#/definitions/StepDocOpen"
        },
        {
          $ref: "#/definitions/StepDocRename"
        },
        {
          $ref: "#/definitions/StepMarkdownInsert"
        },
        {
          $ref: "#/definitions/StepPageSetup"
        },
        {
          $ref: "#/definitions/StepPermission"
        },
        {
          $ref: "#/definitions/StepQuery"
        },
        {
          $ref: "#/definitions/StepRemove"
        },
        {
          $ref: "#/definitions/StepReplace"
        },
        {
          $ref: "#/definitions/StepReplaceMarkdown"
        },
        {
          $ref: "#/definitions/StepReplaceSection"
        },
        {
          $ref: "#/definitions/StepSectionCopy"
        },
        {
          $ref: "#/definitions/StepSurgical"
        },
        {
          $ref: "#/definitions/StepTabCreate"
        },
        {
          $ref: "#/definitions/StepTabModify"
        },
        {
          $ref: "#/definitions/StepTabRename"
        },
        {
          $ref: "#/definitions/StepTextReplace"
        }
      ],
      description: "One workflow step (discriminated union on `kind`)."
    },
    StepDocCreate: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Target alias to bind this document to in the runtime session."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias. Required on every step that reads or writes a file (`docCreate` binds `as` instead)."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        fromDoc: {
          type: "string",
          description: "Optional source document ID or alias to copy from (creates blank document if omitted)."
        },
        kind: {
          type: "string",
          const: "docCreate",
          description: "Workflow step kind."
        },
        mode: {
          type: "string",
          enum: ["PAGES", "PAGELESS"],
          description: 'Document layout mode: "PAGES" or "PAGELESS".'
        },
        pageSetup: {
          $ref: "#/definitions/PageSetup",
          description: "Document page setup geometry, layout mode, and margins."
        },
        pageless: {
          type: "boolean",
          description: 'Whether the document is in pageless mode (convenience alias for mode: "PAGELESS").'
        },
        title: {
          type: "string",
          description: "Document title."
        }
      },
      required: ["as", "kind", "title"],
      additionalProperties: false,
      description: 'Document creation or cloning step (`kind: "docCreate"`).'
    },
    StepDocLifecycle: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Target alias to bind this step's output to in the runtime session."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        kind: {
          type: "string",
          enum: ["docClose", "docDelete", "docTrash"],
          description: "Workflow step kind."
        },
        permanent: {
          type: "boolean",
          description: "Permanently delete document from Drive (docDelete)."
        }
      },
      required: ["doc", "kind"],
      additionalProperties: false,
      description: 'Document lifecycle step (`kind: "docClose" | "docDelete" | "docTrash"`).'
    },
    StepDocOpen: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Target alias to bind this document to in the runtime session."
        },
        doc: {
          type: "string",
          description: "Document ID to load into the session."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        kind: {
          type: "string",
          const: "docOpen",
          description: "Workflow step kind."
        }
      },
      required: ["as", "doc", "kind"],
      additionalProperties: false,
      description: 'Open an existing document step (`kind: "docOpen"`).'
    },
    StepDocRename: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Target alias to bind this step's output to in the runtime session."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        kind: {
          type: "string",
          const: "docRename",
          description: "Workflow step kind."
        },
        title: {
          type: "string",
          description: "New title for the document."
        }
      },
      required: ["doc", "kind", "title"],
      additionalProperties: false,
      description: 'Rename an open document step (`kind: "docRename"`).'
    },
    StepMarkdownInsert: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Anchor alias or binding for newly created elements."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        file: {
          type: "string",
          description: "Local markdown or text file path to read and insert (or '-' for stdin)."
        },
        h1IsTitle: {
          type: "boolean",
          description: "Treat top-level # as Title instead of HEADING_1."
        },
        kind: {
          type: "string",
          const: "markdownInsert",
          description: "Workflow step kind."
        },
        markdown: {
          type: "string",
          description: "Canonical markdown content to render and insert."
        },
        markdownStyles: {
          type: "object",
          additionalProperties: {},
          description: 'Named `::styleName[]::` directive styles (`{ alert: { color: "#f00" } }`). Distinct from native `style`.'
        },
        nodeAfter: {
          type: "string",
          description: "Anchor node to insert after (heading-scoped id from query)."
        },
        nodeAt: {
          type: "string",
          description: "Anchor node to insert at (heading-scoped id from query)."
        },
        nodeBefore: {
          type: "string",
          description: "Anchor node to insert before (heading-scoped id from query)."
        },
        tab: {
          type: "string",
          description: "Target tab ID or title."
        },
        text: {
          type: "string",
          description: "Plain text content (fallback alias for canonical markdown:)."
        }
      },
      required: ["doc", "kind"],
      additionalProperties: false,
      description: 'Insert rendered markdown step (`kind: "markdownInsert"`).'
    },
    StepPageSetup: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Target alias to bind this step's output to in the runtime session."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        kind: {
          type: "string",
          const: "pageSetup",
          description: "Workflow step kind."
        },
        mode: {
          type: "string",
          enum: ["PAGES", "PAGELESS"],
          description: 'Document layout mode: "PAGES" or "PAGELESS".'
        },
        pageSetup: {
          $ref: "#/definitions/PageSetup",
          description: "Document page setup geometry, layout mode, and margins."
        },
        pageless: {
          type: "boolean",
          description: 'Whether the document is in pageless mode (convenience alias for mode: "PAGELESS").'
        },
        tab: {
          type: "string",
          description: "Target tab ID or title."
        }
      },
      required: ["doc", "kind"],
      additionalProperties: false,
      description: 'Document page geometry / layout mode step (`kind: "pageSetup"`).'
    },
    StepPermission: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Target alias to bind this step's output to in the runtime session."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        domain: {
          type: "string",
          description: "Domain name for domain-level file permissions (docPermissionAdd)."
        },
        email: {
          type: "string",
          description: "Email address of grantee for docPermissionAdd or docPermissionRemove."
        },
        emailMessage: {
          type: "string",
          description: "Notification email message body for docPermissionAdd."
        },
        kind: {
          type: "string",
          enum: ["docPermissionAdd", "docPermissionList", "docPermissionRemove"],
          description: "Workflow step kind."
        },
        moveToNewOwnersRoot: {
          type: "boolean",
          description: "Whether to move the file to the new owner's root folder when transferring ownership (docPermissionAdd)."
        },
        permissionId: {
          type: "string",
          description: "Specific permission ID to revoke in docPermissionRemove."
        },
        role: {
          $ref: "#/definitions/DrivePermissionRole",
          description: "Access level role for docPermissionAdd (commenter / fileOrganizer / organizer / owner / reader / writer)."
        },
        scope: {
          $ref: "#/definitions/DrivePermissionScope",
          description: "Grantee access scope for docPermissionAdd or docPermissionRemove (anyone / domain / group / internal / user)."
        },
        sendNotificationEmail: {
          type: "boolean",
          description: "Whether to send an email notification to grantees on docPermissionAdd."
        },
        transferOwnership: {
          type: "boolean",
          description: "Whether to transfer file ownership to the grantee on docPermissionAdd."
        }
      },
      required: ["doc", "kind"],
      additionalProperties: false,
      description: 'Document permission step (`kind: "docPermissionAdd" | "docPermissionList" | "docPermissionRemove"`).'
    },
    DrivePermissionRole: {
      type: "string",
      enum: ["commenter", "fileOrganizer", "organizer", "owner", "reader", "writer"],
      description: "Role assigned to a Drive file permission."
    },
    DrivePermissionScope: {
      type: "string",
      enum: ["anyone", "domain", "group", "internal", "user"],
      description: "Grantee access scope for a Drive file permission."
    },
    StepQuery: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "On query: binds an output alias in `dumped[as]`."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        cols: {
          type: "array",
          items: {
            type: "number"
          },
          description: "Scope query to table column indices (0-based)."
        },
        contains: {
          type: "string",
          description: "Text substring filter for query."
        },
        fontColors: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Scope query to foreground font colors."
        },
        full: {
          type: "boolean",
          description: "Keep every node in query dumps (no heading-only truncation; include table cells)."
        },
        headingLevels: {
          type: "array",
          items: {
            type: "number"
          },
          description: "Scope query to outline heading levels (0 = TITLE, 1 = HEADING_1, etc.)."
        },
        kind: {
          type: "string",
          const: "query",
          description: "Workflow step kind."
        },
        nestingLevels: {
          type: "array",
          items: {
            type: "number"
          },
          description: "Scope query to bullet nesting levels (0 = root bullet, 1 = sub-bullet, etc.)."
        },
        nodeKinds: {
          type: "array",
          items: {
            $ref: "#/definitions/NodeKind"
          },
          description: 'Scope query to structural node kinds ("paragraph", "table", "sectionBreak", etc.).'
        },
        nodeUnder: {
          type: "string",
          description: "Heading or scope node ID for query."
        },
        output: {
          $ref: "#/definitions/QueryOutputFormat",
          description: "Query serialization format (nodes, markdown, outline, or headings)."
        },
        rows: {
          type: "array",
          items: {
            type: "number"
          },
          description: "Scope query to table row indices (0-based)."
        },
        sameList: {
          type: "boolean",
          description: "When targeting a bullet list item with nodeUnder, scopes to contiguous bullet items sharing listId."
        },
        stylesOnly: {
          type: "boolean",
          description: "Scope query to custom styled nodes only."
        },
        tab: {
          type: "string",
          description: "Target tab ID or title."
        },
        unsafeOnly: {
          type: "boolean",
          description: "Scope query to fragile nodes only."
        }
      },
      required: ["as", "doc", "kind"],
      additionalProperties: false,
      description: 'Document inspection / query step (`kind: "query"`).'
    },
    NodeKind: {
      type: "string",
      enum: ["paragraph", "table", "tableOfContents", "sectionBreak", "pageBreak"],
      description: "Structural element kinds on the body tape."
    },
    QueryOutputFormat: {
      type: "string",
      enum: ["headings", "markdown", "nodes", "outline"],
      description: 'Serializer for `kind: query` matches written to `dumped` ("headings" is an alias for "outline").'
    },
    StepRemove: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Target alias to bind this step's output to in the runtime session."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        dangerousRemoveSection: {
          type: "boolean",
          description: "Remove entire section below heading."
        },
        force: {
          type: "boolean",
          description: "Force destructive deletion even if targeting a fragile node."
        },
        kind: {
          type: "string",
          enum: ["dangerousRemoveSection", "remove"],
          description: "Workflow step kind."
        },
        nodeAt: {
          type: "string",
          description: "Heading-scoped id from query to delete (e.g. h.arch.9a1b)."
        },
        remove: {
          type: "boolean",
          description: "Delete this node flag."
        },
        tab: {
          type: "string",
          description: "Target tab ID or title."
        }
      },
      required: ["doc", "kind", "nodeAt"],
      additionalProperties: false,
      description: 'Node or section removal step (`kind: "remove" | "dangerousRemoveSection"`).'
    },
    StepReplace: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Target alias to bind this step's output to in the runtime session."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        alignment: {
          $ref: "#/definitions/ParagraphAlignment",
          description: "Paragraph or table-cell alignment (START / CENTER / END / JUSTIFIED)."
        },
        innerText: {
          type: "string",
          description: "In-place text for a targeted node."
        },
        kind: {
          type: "string",
          enum: ["innerText", "replace"],
          description: "Workflow step kind."
        },
        namedStyleType: {
          $ref: "#/definitions/NamedStyle",
          description: "Change namedStyleType on an existing paragraph."
        },
        nodeAt: {
          type: "string",
          description: "Heading-scoped id from query to replace (e.g. h.arch.9a1b)."
        },
        replace: {
          type: "string",
          description: "Canonical replacement text."
        },
        runs: {
          type: "array",
          items: {
            $ref: "#/definitions/InlineRunInput"
          },
          description: "Explicit styled text runs for inline formatting."
        },
        style: {
          $ref: "#/definitions/StylePatch",
          description: "Native style fields."
        },
        tab: {
          type: "string",
          description: "Target tab ID or title."
        },
        text: {
          type: "string",
          description: "Plain text content (fallback alias for canonical replace:)."
        }
      },
      required: ["doc", "kind", "nodeAt"],
      additionalProperties: false,
      description: 'In-place text replacement step (`kind: "replace" | "innerText"`).'
    },
    ParagraphAlignment: {
      type: "string",
      enum: ["START", "CENTER", "END", "JUSTIFIED"],
      description: "Docs paragraph alignment (updateParagraphStyle.alignment)."
    },
    NamedStyle: {
      type: "string",
      enum: [
        "NORMAL_TEXT",
        "TITLE",
        "SUBTITLE",
        "HEADING_1",
        "HEADING_2",
        "HEADING_3",
        "HEADING_4",
        "HEADING_5",
        "HEADING_6"
      ],
      description: "Docs named paragraph styles, including TITLE and SUBTITLE."
    },
    InlineRunInput: {
      type: "object",
      properties: {
        backgroundColor: {
          type: "string"
        },
        bold: {
          type: "boolean"
        },
        code: {
          type: "boolean"
        },
        end: {
          type: "number"
        },
        fontFamily: {
          type: "string"
        },
        fontSize: {
          type: "number"
        },
        foregroundColor: {
          type: "string"
        },
        italic: {
          type: "boolean"
        },
        link: {
          type: "string"
        },
        start: {
          type: "number"
        },
        strikethrough: {
          type: "boolean"
        },
        text: {
          type: "string"
        },
        underline: {
          type: "boolean"
        }
      },
      additionalProperties: false,
      description: "Input specification for an inline styled run."
    },
    StylePatch: {
      type: "object",
      properties: {
        alignment: {
          $ref: "#/definitions/ParagraphAlignment",
          description: "Paragraph alignment."
        },
        backgroundColor: {
          type: "string",
          description: "Text highlight background color hex string (updateTextStyle.backgroundColor)."
        },
        bold: {
          type: "boolean",
          description: "Bold text flag."
        },
        borderColor: {
          type: "string",
          description: "#RRGGBB on all four cell borders. Default width 1pt. Table or cell."
        },
        borderWidth: {
          type: "number",
          description: "Border width in PT. Requires borderColor."
        },
        cellBackground: {
          type: "string",
          description: "Table cell fill color hex string. Table node = every cell; cell id = that cell."
        },
        cellPadding: {
          type: "number",
          description: "Cell padding in PT (all four sides). Table or cell."
        },
        cellTextAlignment: {
          $ref: "#/definitions/ParagraphAlignment",
          description: "Explicit alias for cell paragraph alignment across a table or cell."
        },
        columnCount: {
          type: "number",
          description: "Section columns (Format > Columns). Only on sectionBreak."
        },
        columnWidth: {
          type: "number",
          description: "FIXED_WIDTH column(s) in PT (min 5). Table = all columns; cell = that column."
        },
        contentAlignment: {
          $ref: "#/definitions/CellContentAlignment",
          description: "Vertical cell alignment. Table or cell."
        },
        fontFamily: {
          type: "string",
          description: "Font family name."
        },
        fontSize: {
          type: "number",
          description: "Font size in points."
        },
        foregroundColor: {
          type: "string",
          description: "Text foreground color hex string."
        },
        indentEnd: {
          type: "number",
          description: "Right indent in PT (updateParagraphStyle.indentEnd)."
        },
        indentFirstLine: {
          type: "number",
          description: "Glyph position in PT. Docs hanging lists: glyph here, text at indentStart. On a bullet, omitted with indentStart → indentStart − 18."
        },
        indentStart: {
          type: "number",
          description: "Text indent in PT. Same field on insert and restyle. Flush level-0 list: indentStart 18 + indentFirstLine 0. Not a nest — use nestingLevel."
        },
        italic: {
          type: "boolean",
          description: "Italic text flag."
        },
        lineSpacing: {
          type: "number",
          description: "100 = single, 150 = 1.5, 200 = double."
        },
        minRowHeight: {
          type: "number",
          description: "Minimum row height in PT. Table = all rows; cell = that row."
        },
        pinnedHeaderRows: {
          type: "number",
          description: "Number of pinned header rows. Table node only."
        },
        preventOverflow: {
          type: "boolean",
          description: "Prevent table row from overflowing across page boundaries. Table or cell/row."
        },
        shading: {
          type: "string",
          description: "Paragraph fill (updateParagraphStyle.shading)."
        },
        spaceAbove: {
          type: "number",
          description: "Space above paragraph in points."
        },
        spaceBelow: {
          type: "number",
          description: "Space below paragraph in points."
        },
        strikethrough: {
          type: "boolean",
          description: "Strikethrough text flag."
        },
        underline: {
          type: "boolean",
          description: "Underline text flag."
        }
      },
      additionalProperties: false,
      description: "Optional style fields on a write op (`style`) or createElement."
    },
    CellContentAlignment: {
      type: "string",
      enum: ["TOP", "MIDDLE", "BOTTOM"],
      description: "Vertical alignment inside a table cell (updateTableCellStyle.contentAlignment)."
    },
    StepReplaceMarkdown: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Anchor alias or binding for newly created elements."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        file: {
          type: "string",
          description: "Local markdown or text file path to read (or '-' for stdin)."
        },
        kind: {
          type: "string",
          const: "replaceMarkdown",
          description: "Workflow step kind."
        },
        markdown: {
          type: "string",
          description: "Markdown content for replacing one node."
        },
        markdownStyles: {
          type: "object",
          additionalProperties: {},
          description: 'Named `::styleName[]::` directive styles (`{ alert: { color: "#f00" } }`). Distinct from native `style`.'
        },
        nodeAt: {
          type: "string",
          description: "Heading-scoped id from query to replace (e.g. h.arch.9a1b)."
        },
        replaceMarkdown: {
          type: ["string", "boolean"],
          description: "Markdown content or boolean flag when file: is specified."
        },
        tab: {
          type: "string",
          description: "Target tab ID or title."
        },
        text: {
          type: "string",
          description: "Plain text content (fallback alias for canonical markdown:)."
        }
      },
      required: ["doc", "kind", "nodeAt"],
      additionalProperties: false,
      description: 'Single-node markdown replacement step (`kind: "replaceMarkdown"`).'
    },
    StepReplaceSection: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Anchor alias or binding for newly created elements."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        file: {
          type: "string",
          description: "Local markdown or text file path to read (or '-' for stdin)."
        },
        force: {
          type: "boolean",
          description: "Force destructive mutation even if deleting child subsections under top-level headings."
        },
        kind: {
          type: "string",
          const: "replaceSection",
          description: "Workflow step kind."
        },
        markdown: {
          type: "string",
          description: "Markdown content for diff-replacing a heading section."
        },
        markdownStyles: {
          type: "object",
          additionalProperties: {},
          description: 'Named `::styleName[]::` directive styles (`{ alert: { color: "#f00" } }`). Distinct from native `style`.'
        },
        nodeAfter: {
          type: "string",
          description: "Anchor node to insert after when inserting adjacent rather than replacing."
        },
        nodeAt: {
          type: "string",
          description: "Target heading node ID from query (e.g. h.arch.9a1b) to diff-replace."
        },
        nodeBefore: {
          type: "string",
          description: "Anchor node to insert before when inserting adjacent rather than replacing."
        },
        replaceSection: {
          type: ["string", "boolean"],
          description: "Markdown content or boolean flag when file: is specified."
        },
        tab: {
          type: "string",
          description: "Target tab ID or title."
        },
        text: {
          type: "string",
          description: "Plain text content (fallback alias for canonical markdown:)."
        }
      },
      required: ["doc", "kind"],
      additionalProperties: false,
      description: 'Section-level auto-diffing replacement step (`kind: "replaceSection"`).'
    },
    StepSectionCopy: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Anchor alias or binding for newly created elements."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        fromDoc: {
          type: "string",
          description: "Source document ID or alias (defaults to target doc)."
        },
        fromSection: {
          type: "string",
          description: "Source heading title, slug, or heading ID to copy from."
        },
        fromTab: {
          type: "string",
          description: "Source tab ID or title (defaults to source doc active tab)."
        },
        includeHeading: {
          type: "boolean",
          description: "Whether to include the source section heading in copy (default true)."
        },
        kind: {
          type: "string",
          const: "sectionCopy",
          description: "Workflow step kind."
        },
        nodeAfter: {
          type: "string",
          description: "Anchor node to insert after (heading-scoped id from query)."
        },
        nodeAt: {
          type: "string",
          description: "Anchor node to insert at (heading-scoped id from query)."
        },
        nodeBefore: {
          type: "string",
          description: "Anchor node to insert before (heading-scoped id from query)."
        },
        tab: {
          type: "string",
          description: "Target tab ID or title."
        }
      },
      required: ["doc", "fromSection", "kind"],
      additionalProperties: false,
      description: 'Server-side section transfer step across documents or tabs (`kind: "sectionCopy"`).'
    },
    StepSurgical: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Anchor alias or binding for newly created elements."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        alignment: {
          $ref: "#/definitions/ParagraphAlignment",
          description: "Paragraph or table-cell alignment (START / CENTER / END / JUSTIFIED)."
        },
        bullet: {
          $ref: "#/definitions/BulletProps",
          description: "Convert this paragraph (and siblings sharing listId) to a Docs bullet preset."
        },
        cloneNode: {
          anyOf: [
            {
              type: "string"
            },
            {
              $ref: "#/definitions/CloneNodeRef"
            }
          ],
          description: "Clone an existing node with style/bullet fidelity (heading-scoped id or ref)."
        },
        cloneNodes: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "string"
              },
              {
                $ref: "#/definitions/CloneNodeRef"
              }
            ]
          },
          description: "Batch cloning of existing nodes."
        },
        dangerousClear: {
          type: "boolean",
          description: "Clear the tab/doc before mutations."
        },
        deleteTableColumn: {
          anyOf: [
            {
              type: "boolean"
            },
            {
              type: "object",
              properties: {
                col: {
                  type: "number"
                }
              },
              additionalProperties: false
            }
          ],
          description: "Delete a table column."
        },
        deleteTableRow: {
          anyOf: [
            {
              type: "boolean"
            },
            {
              type: "object",
              properties: {
                row: {
                  type: "number"
                }
              },
              additionalProperties: false
            }
          ],
          description: "Delete a table row."
        },
        duplicateTableRow: {
          anyOf: [
            {
              type: "boolean"
            },
            {
              type: "object",
              properties: {
                insertBelow: {
                  type: "boolean"
                },
                row: {
                  type: "number"
                }
              },
              additionalProperties: false
            }
          ],
          description: "Duplicate a table row."
        },
        element: {
          type: "object",
          additionalProperties: {},
          description: "Detached element spec to insert."
        },
        elements: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: {}
          },
          description: "Detached element specs to insert in order."
        },
        force: {
          type: "boolean",
          description: "Force destructive mutation even if targeting a fragile node."
        },
        fromDoc: {
          type: "string",
          description: "Source document ID or alias for cloneNode (defaults to doc)."
        },
        fromTab: {
          type: "string",
          description: "Source tab ID or title for cloneNode (defaults to source doc active tab)."
        },
        insertDate: {
          type: "object",
          properties: {
            dateFormat: {
              type: "string"
            },
            displayText: {
              type: "string"
            },
            timestamp: {
              type: "string"
            }
          },
          additionalProperties: false,
          description: "Insert a native date chip."
        },
        insertFootnote: {
          type: "object",
          properties: {
            text: {
              type: "string"
            }
          },
          additionalProperties: false,
          description: "Insert a footnote reference."
        },
        insertImage: {
          type: "object",
          properties: {
            heightPt: {
              type: "number"
            },
            uri: {
              type: "string"
            },
            widthPt: {
              type: "number"
            }
          },
          required: ["uri"],
          additionalProperties: false,
          description: "Insert a public HTTPS inline image."
        },
        insertPerson: {
          type: "object",
          properties: {
            email: {
              type: "string"
            }
          },
          required: ["email"],
          additionalProperties: false,
          description: "Insert a person mention chip."
        },
        insertRichLink: {
          type: "object",
          properties: {
            mimeType: {
              type: "string"
            },
            title: {
              type: "string"
            },
            uri: {
              type: "string"
            }
          },
          required: ["uri"],
          additionalProperties: false,
          description: "Insert a rich link chip."
        },
        insertSectionBreak: {
          anyOf: [
            {
              type: "boolean"
            },
            {
              type: "object",
              properties: {
                sectionType: {
                  type: "string",
                  enum: ["CONTINUOUS", "NEXT_PAGE"]
                }
              },
              additionalProperties: false
            }
          ],
          description: "Insert a section break."
        },
        insertTableColumn: {
          anyOf: [
            {
              type: "boolean"
            },
            {
              type: "object",
              properties: {
                col: {
                  type: "number"
                },
                insertRight: {
                  type: "boolean"
                }
              },
              additionalProperties: false
            }
          ],
          description: "Insert a table column."
        },
        insertTableRow: {
          anyOf: [
            {
              type: "boolean"
            },
            {
              type: "object",
              properties: {
                cells: {
                  type: "array",
                  items: {
                    type: "string"
                  }
                },
                insertBelow: {
                  type: "boolean"
                },
                row: {
                  type: "number"
                }
              },
              additionalProperties: false
            }
          ],
          description: "Insert a table row."
        },
        kind: {
          type: "string",
          const: "surgical",
          description: "Workflow step kind."
        },
        namedStyleType: {
          $ref: "#/definitions/NamedStyle",
          description: "Change namedStyleType on an existing paragraph."
        },
        nodeAfter: {
          type: "string",
          description: "Anchor node to insert after (heading-scoped id from query)."
        },
        nodeAt: {
          type: "string",
          description: "Heading-scoped id from query (e.g. h.arch.9a1b)."
        },
        nodeBefore: {
          type: "string",
          description: "Anchor node to insert before (heading-scoped id from query)."
        },
        runs: {
          type: "array",
          items: {
            $ref: "#/definitions/InlineRunInput"
          },
          description: "Explicit styled text runs for inline formatting."
        },
        style: {
          $ref: "#/definitions/StylePatch",
          description: "Native style fields."
        },
        tab: {
          type: "string",
          description: "Target tab ID or title."
        },
        tableStyle: {
          $ref: "#/definitions/StylePatch",
          description: "Table styling (pinnedHeaderRows, preventOverflow, columnWidth, etc.)."
        }
      },
      required: ["doc", "kind"],
      additionalProperties: false,
      description: 'Surgical DOM and tape mutation step (`kind: "surgical"`).'
    },
    BulletProps: {
      anyOf: [
        {
          type: "object",
          properties: {
            nestingLevel: {
              type: "number",
              description: "Nesting level index (0-based)."
            },
            preset: {
              $ref: "#/definitions/BulletPreset",
              description: "Bullet glyph preset."
            }
          },
          additionalProperties: false
        },
        {
          type: "boolean"
        }
      ],
      description: "Agent-supplied bullet on a NORMAL_TEXT paragraph."
    },
    BulletPreset: {
      type: "string",
      enum: [
        "BULLET_DISC_CIRCLE_SQUARE",
        "BULLET_DIAMONDX_ARROW3D_SQUARE",
        "BULLET_CHECKBOX",
        "BULLET_ARROW_DIAMOND_DISC",
        "BULLET_STAR_CIRCLE_SQUARE",
        "BULLET_ARROW3D_CIRCLE_SQUARE",
        "BULLET_LEFTTRIANGLE_DIAMOND_DISC",
        "BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE",
        "BULLET_DIAMOND_CIRCLE_SQUARE",
        "NUMBERED_DECIMAL_ALPHA_ROMAN",
        "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS",
        "NUMBERED_DECIMAL_NESTED",
        "NUMBERED_UPPERALPHA_ALPHA_ROMAN",
        "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL",
        "NUMBERED_ZERODECIMAL_ALPHA_ROMAN"
      ],
      description: "Docs createParagraphBullets presets."
    },
    CloneNodeRef: {
      type: "object",
      properties: {
        fromDoc: {
          type: "string",
          description: "Optional document ID to clone from."
        },
        fromNode: {
          type: ["number", "string"],
          description: "Alias for nodeId."
        },
        fromTab: {
          type: "string",
          description: "Optional tab ID to clone from."
        },
        innerText: {
          type: "string",
          description: "Replacement text content."
        },
        nodeId: {
          type: ["number", "string"],
          description: "Scoped ID or tape index of the node to clone."
        }
      },
      additionalProperties: false,
      description: "Reference pointing to an existing node to clone."
    },
    StepTabCreate: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Target alias to bind this tab ID to in the runtime session."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        afterTab: {
          type: "string",
          description: "Insert this tab immediately after the specified tab title or ID."
        },
        beforeTab: {
          type: "string",
          description: "Insert this tab immediately before the specified tab title or ID."
        },
        force: {
          type: "boolean",
          description: "Force tab copy even if source contains uncloneable elements (chips/images/equations)."
        },
        fromDoc: {
          type: "string",
          description: "Source document ID or alias when copying a tab across documents (defaults to doc)."
        },
        fromTab: {
          type: "string",
          description: "Source tab ID or title when copying an existing tab (creates blank tab if omitted)."
        },
        index: {
          type: "number",
          description: "Position index for the tab."
        },
        kind: {
          type: "string",
          const: "tabCreate",
          description: "Workflow step kind."
        },
        title: {
          type: "string",
          description: "Title for the new tab. Note: supply final title directly at creation to avoid HTTP 500 on template copies."
        }
      },
      required: ["as", "doc", "kind", "title"],
      additionalProperties: false,
      description: 'Tab creation or cloning step (`kind: "tabCreate"`).'
    },
    StepTabModify: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Target alias to bind this step's output to in the runtime session."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        afterTab: {
          type: "string",
          description: "Move this tab immediately after the specified tab title or ID."
        },
        beforeTab: {
          type: "string",
          description: "Move this tab immediately before the specified tab title or ID."
        },
        index: {
          type: "number",
          description: "Position index for tab move."
        },
        kind: {
          type: "string",
          enum: ["tabDelete", "tabMove", "tabReorder"],
          description: "Workflow step kind."
        },
        tab: {
          type: "string",
          description: "Target tab ID or title."
        }
      },
      required: ["doc", "kind", "tab"],
      additionalProperties: false,
      description: 'Tab modification step (`kind: "tabDelete" | "tabMove" | "tabReorder"`).'
    },
    StepTabRename: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Target alias to bind this step's output to in the runtime session."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        kind: {
          type: "string",
          const: "tabRename",
          description: "Workflow step kind."
        },
        tab: {
          type: "string",
          description: "Target tab ID or current title to rename."
        },
        title: {
          type: "string",
          description: "New title for the tab. Note: tabRename 500s on docs lacking root 't.0' (set title directly on tabCreate)."
        }
      },
      required: ["doc", "kind", "tab", "title"],
      additionalProperties: false,
      description: 'Tab renaming step (`kind: "tabRename"`).'
    },
    StepTextReplace: {
      type: "object",
      properties: {
        as: {
          type: "string",
          description: "Target alias to bind this step's output to in the runtime session."
        },
        doc: {
          type: "string",
          description: "Target document ID or alias."
        },
        dump: {
          type: "boolean",
          description: "Dump document or tab metadata into `dumped[as]`."
        },
        allTabs: {
          type: "boolean",
          description: "Replace all occurrences across all tabs."
        },
        find: {
          type: "string",
          description: "String to find for replacement."
        },
        kind: {
          type: "string",
          const: "textReplace",
          description: "Workflow step kind."
        },
        matchCase: {
          type: "boolean",
          description: "Match case in textReplace (default true)."
        },
        nodeAfter: {
          type: "string",
          description: "Optional anchor node to insert after."
        },
        nodeAt: {
          type: "string",
          description: "Optional anchor node to replace text within."
        },
        nodeBefore: {
          type: "string",
          description: "Optional anchor node to insert before."
        },
        nodeUnder: {
          type: "string",
          description: "Optional heading or scope node to restrict replacement under."
        },
        replace: {
          type: "string",
          description: "Canonical replacement text string."
        },
        tab: {
          type: "string",
          description: "Target tab ID or title."
        },
        text: {
          type: "string",
          description: "Plain text replacement (fallback alias for replace:)."
        }
      },
      required: ["doc", "find", "kind", "replace"],
      additionalProperties: false,
      description: 'Plain find-and-replace text step (`kind: "textReplace"`).'
    }
  }
};
// src/commands/run/__generated__/GdocsmithJsonOutputSchema.json
var GdocsmithJsonOutputSchema_default = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    diff: {
      type: "string",
      description: "Unified git diff of changes (populated on dryRun; empty string when 0 changes detected)."
    },
    dryRun: {
      type: "boolean",
      description: "True when `dryRun: true` previewed without writing."
    },
    dumped: {
      type: "object",
      additionalProperties: {},
      description: "Values extracted by `kind: query` (with `as:`) and `dump: true`."
    },
    highlights: {
      type: "array",
      items: {
        $ref: "#/definitions/ApplyHighlightDocJson"
      },
      description: "Highlights of newly created docs, tabs, and headings."
    },
    ok: {
      type: "boolean",
      description: "Status confirmation for minimal response."
    },
    stepsCount: {
      type: "number",
      description: "Workflow steps executed."
    }
  },
  additionalProperties: false,
  definitions: {
    ApplyHighlightDocJson: {
      type: "object",
      properties: {
        as: {
          type: "string"
        },
        id: {
          type: "string"
        },
        tabs: {
          type: "array",
          items: {
            $ref: "#/definitions/ApplyHighlightTabJson"
          }
        },
        title: {
          type: "string"
        }
      },
      required: ["id"],
      additionalProperties: false,
      description: "Document item in highlights."
    },
    ApplyHighlightTabJson: {
      type: "object",
      properties: {
        as: {
          type: "string"
        },
        headings: {
          type: "array",
          items: {
            $ref: "#/definitions/ApplyHighlightHeadingJson"
          }
        },
        id: {
          type: "string"
        },
        title: {
          type: "string"
        }
      },
      required: ["id"],
      additionalProperties: false,
      description: "Tab item in highlights."
    },
    ApplyHighlightHeadingJson: {
      type: "object",
      properties: {
        id: {
          type: "string"
        },
        text: {
          type: "string"
        }
      },
      required: ["id", "text"],
      additionalProperties: false,
      description: "Newly created heading item in highlights."
    }
  }
};

// src/commands/run/__generated__/index.ts
var GdocsmithDocumentSchema = GdocsmithDocumentSchema_default;
var GdocsmithJsonOutputSchema = GdocsmithJsonOutputSchema_default;

// src/commands/run/command.ts
var runCommand = {
  description: "Declarative Google Docs workflow engine for queries, dry-run diff previews, and document updates.",
  handler: async (ctx) => {
    const doc = ctx.inputsAs();
    const result = await applyScriptExecute(doc, { force: Boolean(doc.force) });
    const quiet = Boolean(doc.quiet);
    const payload = {
      ...doc.dryRun ? { diff: result.diff ?? "", dryRun: true } : result.diff ? { diff: result.diff } : {},
      ...Object.keys(result.dumped).length > 0 ? { dumped: result.dumped } : {},
      ...result.highlights.length > 0 ? { highlights: result.highlights } : {},
      ok: true,
      stepsCount: result.stepsCount
    };
    if (quiet && !doc.dryRun && Object.keys(result.dumped).length === 0) {
      return { ok: true, stepsCount: result.stepsCount };
    }
    return payload;
  },
  inputSchema: GdocsmithDocumentSchema,
  key: "run",
  kind: "document",
  notes: "• Pipe stdin or pass one JSON document. Knobs: `dryRun`, `force`, `quiet` on the document.\n" + "• Each step requires `kind` (e.g. docOpen|docClose|docCreate|tabCreate|query|markdownInsert|replaceSection|…).\n" + "• File-touching steps require `doc:` (raw id or open alias). `docCreate` binds `as` (optional `fromDoc:` to clone). There is no run-level documentId.\n" + "• Raw IDs only: extract between `/document/d/` and `/edit`. Full URLs are rejected.\n" + "• Surgical targeting: copy heading-scoped ids from `kind: query` into `nodeAt`, `nodeAfter`, or `nodeBefore` (e.g. `h.arch.9a1b`). NEVER compute startIndex/endIndex or write raw batchUpdate scripts.\n" + "• In-place updates: prefer `replaceSection`, `replaceMarkdown`, or `replace` over deleting and re-inserting content (no demolish-and-rebuild). Use `replace` or `replaceMarkdown` for heading titles; `replaceSection` on an H1 replaces all subsections under it.\n" + "• Real headings only (`TITLE`, `HEADING_1`–`HEADING_3`). No bullet glyphs in surgical text; use run-in bold (`**Label**: value`).\n" + "• Bindings: `docOpen`, `docCreate`, and `tabCreate` set aliases. Every `run` call is stateless; aliases do not persist across multiple `run` invocations. `dump: true` on docOpen/docCreate/tabCreate dumps metadata into `dumped[as]`. `query` with `as:` writes matches into `dumped[as]` (`output: markdown` or `nodes`). Query aliases cannot be used as mutation anchors.\n" + "• Cross-doc transfers: use `kind: sectionCopy` with `fromDoc:` and `fromSection:` to transfer sections server-side without streaming markdown, or query source with `output: markdown` and write with `replaceSection`. Anchors must always belong to the target `doc:`.\n" + "• Symbolic links: use `[Label](tab:TabTitle#HeadingTitle)`, `[Label](tab:TabTitle)`, or `[Label](#HeadingTitle)` in markdown; gdocsmith automatically resolves them to native Docs deep links (`?tab=...#heading=...`).\n" + "• Prefer one `run` per phase until step kinds are proven; then batch related steps. Chip/table writes use `kind: surgical`.\n" + "• Dry run: optional `dryRun: true` returns a unified git diff without writing. Run mutations directly without requiring dry-run first; use dryRun only when you need to inspect an expected diff.",
  outputSchema: GdocsmithJsonOutputSchema
};
// src/commands/status/__generated__/StatusJsonOutputSchema.json
var StatusJsonOutputSchema_default = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    version: {
      type: "string",
      description: "App version from program root."
    }
  },
  required: ["version"],
  additionalProperties: false,
  definitions: {}
};

// src/commands/status/__generated__/index.ts
var StatusJsonOutputSchema = StatusJsonOutputSchema_default;

// src/commands/status/command.ts
var statusCommand = {
  description: "Show app version.",
  handler: (ctx) => {
    const out = { version: ctx.program.version };
    if (ctx.invocation === "cli") {
      if (ctx.hasFlag("json")) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.log(`version=${out.version}`);
      }
      return;
    }
    return out;
  },
  key: "status",
  options: [
    {
      description: "Emit JSON.",
      kind: "presence" /* Presence */,
      name: "json"
    }
  ],
  outputSchema: StatusJsonOutputSchema
};

// src/program.ts
var program = {
  commands: [runCommand, statusCommand],
  description: createIdentity.desc,
  docs: {
    topics: {
      readme: {
        text: README_default
      }
    }
  },
  key: createIdentity.key,
  mcpServer: { enabled: true },
  version: "1.0.2"
};

// src/index.ts
var cli = new Cli(program);
await cli.run();
