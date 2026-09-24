/**
 * PVO SDK prototype
 * A PVO is an ordinary MP4 or MOV with one top-level `uuid` box appended to it.
 * The box contains a four-byte `pvom` subtype followed by a UTF-8 manifest.
 */

export const PVO_SPEC_VERSION = "0.1-prototype";
export const PVO_MANIFEST_LIMIT = 2 * 1024 * 1024;

// 5a125a6e-8c7a-4ba8-9dd9-5e449a275056 (stable prototype UUID)
export const PVO_UUID = "5a125a6e-8c7a-4ba8-9dd9-5e449a275056";
const PVO_UUID_BYTES = Uint8Array.from([
  0x5a, 0x12, 0x5a, 0x6e, 0x8c, 0x7a, 0x4b, 0xa8,
  0x9d, 0xd9, 0x5e, 0x44, 0x9a, 0x27, 0x50, 0x56,
]);
const UUID_TYPE = Uint8Array.from([0x75, 0x75, 0x69, 0x64]);
const MANIFEST_SUBTYPE = Uint8Array.from([0x70, 0x76, 0x6f, 0x6d]); // pvom
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const ACTION_TYPES = new Set([
  "show",
  "hide",
  "set",
  "goto_scene",
  "seek",
  "request",
  "open_url",
  "chain",
  "branch",
  "custom",
]);
const COMPONENT_KINDS = new Set(["tooltip", "card", "choice", "form"]);

function bytesEqual(bytes, offset, target) {
  if (offset < 0 || offset + target.length > bytes.length) return false;
  return target.every((value, index) => bytes[offset + index] === value);
}

function concatBytes(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

async function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input && typeof input.arrayBuffer === "function") {
    return new Uint8Array(await input.arrayBuffer());
  }
  throw new TypeError("PVO input must be a Blob, File, ArrayBuffer, or Uint8Array.");
}

function readBoxSize(view, offset, available) {
  const smallSize = view.getUint32(offset, false);
  if (smallSize === 0) return { size: available, headerSize: 8, extendsToEnd: true };
  if (smallSize !== 1) return { size: smallSize, headerSize: 8, extendsToEnd: false };
  if (offset + 16 > view.byteLength) throw new Error("Invalid extended media box header.");
  const largeSize = view.getBigUint64(offset + 8, false);
  if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("This media file is too large for the browser prototype.");
  }
  return { size: Number(largeSize), headerSize: 16, extendsToEnd: false };
}

export function inspectMp4(inputBytes) {
  const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = [];
  let offset = 0;

  while (offset < bytes.length) {
    if (bytes.length - offset < 8) {
      throw new Error(`Invalid media file: ${bytes.length - offset} trailing byte(s) after the last box.`);
    }
    const { size, headerSize, extendsToEnd } = readBoxSize(view, offset, bytes.length - offset);
    if (size < headerSize || offset + size > bytes.length) {
      throw new Error(`Invalid media box at byte ${offset}.`);
    }
    const type = textDecoder.decode(bytes.subarray(offset + 4, offset + 8));
    const uuidOffset = offset + headerSize;
    const payloadOffset = type === "uuid" ? uuidOffset + 16 : offset + headerSize;
    if (type === "uuid" && payloadOffset > offset + size) {
      throw new Error(`Invalid uuid box at byte ${offset}.`);
    }
    boxes.push({ offset, size, headerSize, type, uuidOffset, payloadOffset, extendsToEnd });
    offset += size;
  }

  return boxes;
}

function isManifestBox(bytes, box) {
  return (
    box.type === "uuid" &&
    bytesEqual(bytes, box.uuidOffset, PVO_UUID_BYTES) &&
    bytesEqual(bytes, box.payloadOffset, MANIFEST_SUBTYPE)
  );
}

function stripPvoBoxes(bytes, boxes) {
  const chunks = [];
  for (const box of boxes) {
    if (isManifestBox(bytes, box)) continue;
    let chunk = bytes.slice(box.offset, box.offset + box.size);
    // A size=0 box claims the rest of the file. Give it an explicit size before
    // appending PVO data so normal media parsers can continue to the new box.
    if (box.extendsToEnd) {
      if (chunk.length > 0xffffffff) {
        throw new Error("A size=0 media box larger than 4 GB is not supported by this prototype.");
      }
      new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).setUint32(0, chunk.length, false);
    }
    chunks.push(chunk);
  }
  return concatBytes(chunks);
}

function makeManifestBox(manifest) {
  const json = textEncoder.encode(JSON.stringify(manifest));
  if (json.length > PVO_MANIFEST_LIMIT) {
    throw new Error(`Manifest exceeds the ${PVO_MANIFEST_LIMIT / 1024 / 1024} MB prototype limit.`);
  }
  const size = 8 + PVO_UUID_BYTES.length + MANIFEST_SUBTYPE.length + json.length;
  const box = new Uint8Array(size);
  const view = new DataView(box.buffer);
  view.setUint32(0, size, false);
  box.set(UUID_TYPE, 4);
  box.set(PVO_UUID_BYTES, 8);
  box.set(MANIFEST_SUBTYPE, 24);
  box.set(json, 28);
  return box;
}

function mediaMimeType(input) {
  const type = String(input?.type || "").toLowerCase();
  const name = String(input?.name || "");
  return type === "video/quicktime" || /(?:\.pvo)?\.mov$/i.test(name) ? "video/quicktime" : "video/mp4";
}

/** Append or replace the PVO manifest in an MP4 or MOV while preserving its media type. */
export async function packPvo(media, manifest) {
  const result = validatePvo(manifest);
  if (!result.valid) {
    throw new Error(`Invalid PVO manifest:\n${result.errors.join("\n")}`);
  }
  const bytes = await toBytes(media);
  const boxes = inspectMp4(bytes);
  if (!boxes.some((box) => box.type === "ftyp")) {
    throw new Error("This file does not look like an MP4 or MOV (missing ftyp box).");
  }
  const base = stripPvoBoxes(bytes, boxes);
  return new Blob([base, makeManifestBox(manifest)], { type: mediaMimeType(media) });
}

/** Read a PVO file and return both its manifest and its plain-video fallback bytes. */
export async function readPvo(file) {
  const bytes = await toBytes(file);
  const boxes = inspectMp4(bytes);
  const manifests = boxes.filter((box) => isManifestBox(bytes, box));
  if (!manifests.length) throw new Error("No PVO manifest was found in this MP4.");
  const box = manifests.at(-1);
  const jsonStart = box.payloadOffset + MANIFEST_SUBTYPE.length;
  const manifestLength = box.offset + box.size - jsonStart;
  if (manifestLength > PVO_MANIFEST_LIMIT) {
    throw new Error(`PVO manifest exceeds the ${PVO_MANIFEST_LIMIT / 1024 / 1024} MB prototype limit.`);
  }
  let manifest;
  try {
    manifest = JSON.parse(textDecoder.decode(bytes.subarray(jsonStart, box.offset + box.size)));
  } catch (error) {
    throw new Error(`The PVO manifest is not valid JSON: ${error.message}`);
  }
  const validation = validatePvo(manifest);
  const videoBytes = stripPvoBoxes(bytes, boxes);
  return {
    manifest,
    validation,
    videoBlob: new Blob([videoBytes], { type: mediaMimeType(file) }),
    fileName: file?.name || (mediaMimeType(file) === "video/quicktime" ? "video.pvo.mov" : "video.pvo.mp4"),
  };
}

/** Return null for a plain MP4 or MOV; throw only when a detected PVO is malformed. */
export async function tryReadPvo(file) {
  try {
    return await readPvo(file);
  } catch (error) {
    if (String(error?.message).includes("No PVO manifest")) return null;
    throw error;
  }
}

function validateActions(actions, path, errors, warnings, ids) {
  if (actions == null) return;
  const list = Array.isArray(actions) ? actions : [actions];
  list.forEach((action, index) => {
    const at = `${path}[${index}]`;
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      errors.push(`${at} must be an action object.`);
      return;
    }
    if (!ACTION_TYPES.has(action.type)) {
      errors.push(`${at}.type must be one of: ${[...ACTION_TYPES].join(", ")}.`);
      return;
    }
    if ((action.type === "show" || action.type === "hide") && typeof action.component === "string" && !ids.components.has(action.component)) {
      errors.push(`${at} references missing component "${action.component}".`);
    }
    if ((action.type === "show" || action.type === "hide") && !action.component) {
      errors.push(`${at}.component is required.`);
    }
    if (action.type === "set" && typeof action.key !== "string") errors.push(`${at}.key is required.`);
    if (action.type === "goto_scene" && !ids.scenes.has(action.scene)) {
      errors.push(`${at} references missing scene "${action.scene}".`);
    }
    if (action.type === "seek" && action.scene && !ids.scenes.has(action.scene)) {
      errors.push(`${at} references missing scene "${action.scene}".`);
    }
    if (action.type === "seek" && !action.scene && !Number.isFinite(action.time)) errors.push(`${at} needs a scene or numeric time.`);
    if (action.type === "request" && (typeof action.url !== "string" || !/^https?:\/\//i.test(action.url))) errors.push(`${at}.url must be an absolute HTTP(S) URL.`);
    if (action.type === "open_url" && (typeof action.url !== "string" || !/^https?:\/\//i.test(action.url))) errors.push(`${at}.url must be an absolute HTTP(S) URL.`);
    if (action.type === "chain" && !Array.isArray(action.actions)) errors.push(`${at}.actions must be an array.`);
    if (action.type === "chain") validateActions(action.actions, `${at}.actions`, errors, warnings, ids);
    if (action.type === "branch") {
      if (!Array.isArray(action.cases) || action.cases.length === 0) errors.push(`${at}.cases must contain at least one case.`);
      (action.cases || []).forEach((branchCase, caseIndex) => {
        if (!branchCase?.when) errors.push(`${at}.cases[${caseIndex}].when is required.`);
        validateActions(branchCase?.then, `${at}.cases[${caseIndex}].then`, errors, warnings, ids);
      });
      validateActions(action.else, `${at}.else`, errors, warnings, ids);
    }
    if (action.type === "request") {
      validateActions(action.on_success, `${at}.on_success`, errors, warnings, ids);
      validateActions(action.on_error, `${at}.on_error`, errors, warnings, ids);
    }
  });
}

/** Validate the small, deliberately data-only prototype manifest. */
export function validatePvo(manifest) {
  const errors = [];
  const warnings = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { valid: false, errors: ["Manifest must be a JSON object."], warnings };
  }
  if (typeof manifest.spec_version !== "string") errors.push("spec_version is required.");
  else if (manifest.spec_version !== PVO_SPEC_VERSION) warnings.push(`This SDK targets ${PVO_SPEC_VERSION}; received ${manifest.spec_version}.`);
  if (!Array.isArray(manifest.scenes) || !manifest.scenes.length) errors.push("scenes must contain at least one scene.");
  if (!Array.isArray(manifest.components)) errors.push("components must be an array.");

  const ids = { scenes: new Set(), components: new Set(), hotspots: new Set() };
  for (const [index, scene] of (manifest.scenes || []).entries()) {
    const path = `scenes[${index}]`;
    if (!scene?.id || typeof scene.id !== "string") errors.push(`${path}.id is required.`);
    else if (ids.scenes.has(scene.id)) errors.push(`${path}.id "${scene.id}" is duplicated.`);
    else ids.scenes.add(scene.id);
    if (!Number.isFinite(scene?.start) || scene.start < 0) errors.push(`${path}.start must be 0 or greater.`);
    if (!Number.isFinite(scene?.end) || scene.end <= scene.start) errors.push(`${path}.end must be greater than start.`);
  }
  const orderedScenes = [...(manifest.scenes || [])]
    .filter((scene) => Number.isFinite(scene?.start) && Number.isFinite(scene?.end))
    .sort((a, b) => a.start - b.start);
  for (let index = 1; index < orderedScenes.length; index += 1) {
    if (orderedScenes[index].start < orderedScenes[index - 1].end) {
      errors.push(`Scenes "${orderedScenes[index - 1].id}" and "${orderedScenes[index].id}" overlap.`);
    }
  }
  for (const [index, component] of (manifest.components || []).entries()) {
    const path = `components[${index}]`;
    if (!component?.id || typeof component.id !== "string") errors.push(`${path}.id is required.`);
    else if (ids.components.has(component.id)) errors.push(`${path}.id "${component.id}" is duplicated.`);
    else ids.components.add(component.id);
    if (!COMPONENT_KINDS.has(component?.kind)) errors.push(`${path}.kind must be tooltip, card, choice, or form.`);
    if (component?.kind === "tooltip" && typeof component.text !== "string") errors.push(`${path}.text is required for a tooltip.`);
    if (component?.kind === "card" && typeof component.title !== "string" && typeof component.text !== "string") errors.push(`${path} needs a title or text.`);
    if (component?.kind === "choice" && (!Array.isArray(component.options) || component.options.length < 2 || component.options.length > 4)) {
      errors.push(`${path}.options must contain 2 to 4 choices.`);
    }
    if (component?.kind === "choice" && Array.isArray(component.options)) {
      component.options.forEach((option, optionIndex) => {
        if (typeof option?.label !== "string") errors.push(`${path}.options[${optionIndex}].label is required.`);
        if (!option?.actions && !option?.action) errors.push(`${path}.options[${optionIndex}] needs an action or actions.`);
      });
    }
    if (component?.kind === "form") {
      if (!Array.isArray(component.fields)) errors.push(`${path}.fields must be an array.`);
      if (!component.on_submit) errors.push(`${path}.on_submit is required for a form.`);
      const fieldNames = new Set();
      (component.fields || []).forEach((field, fieldIndex) => {
        if (typeof field?.name !== "string" || !field.name) errors.push(`${path}.fields[${fieldIndex}].name is required.`);
        else if (fieldNames.has(field.name)) errors.push(`${path}.fields[${fieldIndex}].name "${field.name}" is duplicated.`);
        else fieldNames.add(field.name);
        if (field?.type === "choice" && (!Array.isArray(field.options) || field.options.length < 1)) {
          errors.push(`${path}.fields[${fieldIndex}].options is required for a choice field.`);
        }
      });
    }
  }
  if (manifest.initial_scene && !ids.scenes.has(manifest.initial_scene)) {
    errors.push(`initial_scene references missing scene "${manifest.initial_scene}".`);
  }

  for (const [index, scene] of (manifest.scenes || []).entries()) {
    if (scene.next && !ids.scenes.has(scene.next)) errors.push(`scenes[${index}].next references missing scene "${scene.next}".`);
    validateActions(scene.on_enter, `scenes[${index}].on_enter`, errors, warnings, ids);
    validateActions(scene.on_exit, `scenes[${index}].on_exit`, errors, warnings, ids);
  }
  for (const [index, component] of (manifest.components || []).entries()) {
    for (const [optionIndex, option] of (component.options || []).entries()) {
      validateActions(option.actions || option.action, `components[${index}].options[${optionIndex}].actions`, errors, warnings, ids);
    }
    validateActions(component.on_submit, `components[${index}].on_submit`, errors, warnings, ids);
    validateActions(component.actions, `components[${index}].actions`, errors, warnings, ids);
  }
  for (const [index, hotspot] of (manifest.hotspots || []).entries()) {
    const path = `hotspots[${index}]`;
    if (!hotspot?.id) errors.push(`${path}.id is required.`);
    else if (ids.hotspots.has(hotspot.id)) errors.push(`${path}.id "${hotspot.id}" is duplicated.`);
    else ids.hotspots.add(hotspot.id);
    if (hotspot.scene && !ids.scenes.has(hotspot.scene)) errors.push(`${path}.scene references missing scene "${hotspot.scene}".`);
    for (const key of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(hotspot?.[key]) || hotspot[key] < 0 || hotspot[key] > 1) {
        errors.push(`${path}.${key} must be between 0 and 1.`);
      }
    }
    if ((hotspot?.x || 0) + (hotspot?.width || 0) > 1.000001) errors.push(`${path} extends beyond the right edge.`);
    if ((hotspot?.y || 0) + (hotspot?.height || 0) > 1.000001) errors.push(`${path} extends beyond the bottom edge.`);
    if (!hotspot.actions) errors.push(`${path}.actions is required.`);
    const hotspotScene = (manifest.scenes || []).find((scene) => scene.id === hotspot.scene);
    if (hotspotScene && Number.isFinite(hotspot.start) && hotspot.start < hotspotScene.start) errors.push(`${path}.start is before its scene.`);
    if (hotspotScene && Number.isFinite(hotspot.end) && hotspot.end > hotspotScene.end) errors.push(`${path}.end is after its scene.`);
    validateActions(hotspot.actions, `${path}.actions`, errors, warnings, ids);
  }
  for (const [index, trigger] of (manifest.triggers || []).entries()) {
    if (trigger.scene && !ids.scenes.has(trigger.scene)) errors.push(`triggers[${index}].scene references a missing scene.`);
    if (!Number.isFinite(trigger.at) || trigger.at < 0) errors.push(`triggers[${index}].at must be 0 or greater.`);
    const triggerScene = (manifest.scenes || []).find((scene) => scene.id === trigger.scene);
    if (triggerScene && Number.isFinite(trigger.at) && (trigger.at < triggerScene.start || trigger.at > triggerScene.end)) {
      errors.push(`triggers[${index}].at must fall inside scene "${trigger.scene}".`);
    }
    validateActions(trigger.actions, `triggers[${index}].actions`, errors, warnings, ids);
  }
  if ((manifest.hotspots || []).length === 0) warnings.push("This manifest has no hotspots.");
  return { valid: errors.length === 0, errors, warnings };
}

function readPath(source, path) {
  if (!path) return source;
  const parts = path.startsWith("/")
    ? path.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    : path.split(".");
  return parts.filter(Boolean).reduce((value, key) => value?.[key], source);
}

function writePath(target, path, value) {
  const parts = String(path).split(".").filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = value;
}

export function evaluateWhen(condition, context = {}) {
  if (!condition) return true;
  if (Array.isArray(condition)) return condition.every((item) => evaluateWhen(item, context));
  if (Array.isArray(condition.all)) return condition.all.every((item) => evaluateWhen(item, context));
  if (Array.isArray(condition.any)) return condition.any.some((item) => evaluateWhen(item, context));

  let actual;
  if (condition.key != null) actual = readPath(context.state, condition.key);
  else if (condition.response != null) actual = readPath(context.response, condition.response);
  else if (condition.source === "response") actual = readPath(context.response, condition.path);
  else actual = readPath(context.state, condition.path);

  if (Object.hasOwn(condition, "is")) return actual === condition.is;
  if (Object.hasOwn(condition, "not")) return actual !== condition.not;
  if (Object.hasOwn(condition, "gt")) return Number(actual) > Number(condition.gt);
  if (Object.hasOwn(condition, "gte")) return Number(actual) >= Number(condition.gte);
  if (Object.hasOwn(condition, "lt")) return Number(actual) < Number(condition.lt);
  if (Object.hasOwn(condition, "lte")) return Number(actual) <= Number(condition.lte);
  if (Object.hasOwn(condition, "in")) return Array.isArray(condition.in) && condition.in.includes(actual);
  if (Object.hasOwn(condition, "exists")) return condition.exists ? actual !== undefined && actual !== null : actual == null;
  return Boolean(actual);
}

export function resolveTemplates(value, context = {}) {
  if (Array.isArray(value)) return value.map((item) => resolveTemplates(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTemplates(item, context)]));
  }
  if (typeof value !== "string") return value;

  const exact = value.match(/^\{(state|response)\.([^}]+)\}$/);
  if (exact) return readPath(context[exact[1]], exact[2]);
  return value.replace(/\{(state|response)\.([^}]+)\}/g, (_, source, path) => {
    const resolved = readPath(context[source], path);
    return resolved == null ? "" : String(resolved);
  });
}

export class PvoRuntime {
  constructor(manifest, handlers = {}) {
    const validation = validatePvo(manifest);
    if (!validation.valid) throw new Error(`Invalid PVO manifest:\n${validation.errors.join("\n")}`);
    this.manifest = manifest;
    this.handlers = handlers;
    this.state = structuredClone(manifest.state?.initial || {});
    this.visible = new Set();
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, detail = {}) {
    const snapshot = { type, state: structuredClone(this.state), visible: [...this.visible], ...detail };
    this.listeners.forEach((listener) => listener(snapshot));
    this.handlers.onEvent?.(snapshot);
  }

  setState(key, value) {
    writePath(this.state, key, value);
    this.emit("state", { key, value });
  }

  reset() {
    this.state = structuredClone(this.manifest.state?.initial || {});
    this.visible.clear();
    this.emit("reset");
  }

  getComponent(idOrObject) {
    if (idOrObject && typeof idOrObject === "object") return idOrObject;
    return (this.manifest.components || []).find((component) => component.id === idOrObject);
  }

  async execute(actionOrActions, context = {}) {
    if (Array.isArray(actionOrActions)) {
      let last;
      for (const action of actionOrActions) last = await this.execute(action, context);
      return last;
    }
    const action = actionOrActions;
    if (!action) return undefined;
    const actionContext = { ...context, state: this.state };
    if (!evaluateWhen(action.when, actionContext)) return { skipped: true };

    switch (action.type) {
      case "show": {
        const component = this.getComponent(action.component);
        if (!component) throw new Error(`Cannot show missing component "${action.component}".`);
        if (component.id) this.visible.add(component.id);
        await this.handlers.show?.(component, actionContext);
        this.emit("show", { component: component.id || null });
        return component;
      }
      case "hide": {
        const component = this.getComponent(action.component);
        if (typeof action.component === "string") this.visible.delete(action.component);
        if (component?.id) this.visible.delete(component.id);
        await this.handlers.hide?.(component || action.component, actionContext);
        this.emit("hide", { component: component?.id || action.component });
        return undefined;
      }
      case "set": {
        const current = readPath(this.state, action.key);
        const value = Object.hasOwn(action, "add")
          ? Number(current || 0) + Number(resolveTemplates(action.add, actionContext))
          : resolveTemplates(action.value, actionContext);
        this.setState(action.key, value);
        return value;
      }
      case "goto_scene": {
        await this.handlers.gotoScene?.(action.scene, actionContext);
        this.emit("goto_scene", { scene: action.scene });
        return action.scene;
      }
      case "seek": {
        if (action.scene) await this.handlers.gotoScene?.(action.scene, actionContext);
        else await this.handlers.seek?.(Number(action.time || 0), actionContext);
        this.emit("seek", { scene: action.scene, time: action.time });
        return action.scene ?? action.time;
      }
      case "chain":
        return this.execute(action.actions || [], actionContext);
      case "branch": {
        const match = (action.cases || []).find((item) => evaluateWhen(item.when, actionContext));
        return this.execute(match?.then || action.else, actionContext);
      }
      case "request":
        return this.executeRequest(action, actionContext);
      case "open_url": {
        const url = resolveTemplates(action.url, actionContext);
        if (this.handlers.openUrl) return this.handlers.openUrl(url, actionContext);
        if (typeof window !== "undefined" && window.confirm(`Open ${new URL(url).host}?`)) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return url;
      }
      case "custom":
        return this.handlers.custom?.(action.name, resolveTemplates(action.payload, actionContext), actionContext);
      default:
        throw new Error(`Unsupported PVO action "${action.type}".`);
    }
  }

  async executeRequest(action, context) {
    const url = resolveTemplates(action.url, context);
    const parsed = new URL(url, typeof window === "undefined" ? "https://pvo.local" : window.location.href);
    const allowed = this.manifest.allowed_domains || [];
    if (allowed.length && !allowed.includes(parsed.host)) {
      throw new Error(`Request domain ${parsed.host} is not in allowed_domains.`);
    }

    const method = String(action.method || "GET").toUpperCase();
    const resolvedBody = resolveTemplates(action.body, context);
    const headers = resolveTemplates(action.headers || {}, context);
    const options = { method, headers: { ...headers } };
    if (resolvedBody != null && method !== "GET" && method !== "HEAD") {
      if (typeof resolvedBody === "string") options.body = resolvedBody;
      else {
        options.body = JSON.stringify(resolvedBody);
        if (!Object.keys(options.headers).some((key) => key.toLowerCase() === "content-type")) {
          options.headers["Content-Type"] = "application/json";
        }
      }
    }

    this.emit("request_start", { url, method });
    try {
      const response = this.handlers.request
        ? await this.handlers.request({ url, ...options }, context)
        : await fetch(url, options);
      let data;
      if (response && typeof response.json === "function") {
        if (!response.ok) throw new Error(`Request failed with ${response.status}.`);
        const type = response.headers?.get?.("content-type") || "";
        data = type.includes("json") ? await response.json() : await response.text();
      } else data = response;
      if (action.into) this.setState(action.into, data);
      const nextContext = { ...context, state: this.state, response: data };
      await this.execute(action.on_success, nextContext);
      this.emit("request_success", { url, response: data });
      return data;
    } catch (error) {
      const errorContext = { ...context, state: this.state, response: { error: error.message } };
      await this.execute(action.on_error, errorContext);
      this.emit("request_error", { url, error: error.message });
      if (!action.on_error) throw error;
      return undefined;
    }
  }
}

export function createPvoRuntime(manifest, handlers = {}) {
  return new PvoRuntime(manifest, handlers);
}
