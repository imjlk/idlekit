type CloneMap = WeakMap<object, any>;

/**
 * Deep clone that preserves object prototypes and property descriptors.
 * - Supports: primitives, arrays, plain/custom objects, Date, Map, Set, RegExp.
 * - Functions are returned as-is.
 * - Cycles are supported via WeakMap.
 */
export function deepClonePreservingPrototype<T>(input: T): T {
  const seen: CloneMap = new WeakMap();
  return cloneAny(input, seen);
}

function cloneAny<T>(value: T, seen: CloneMap): T {
  if (value === null || value === undefined) return value;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean" || kind === "bigint" || kind === "symbol") {
    return value;
  }
  if (kind === "function") return value;

  const obj = value as unknown as object;
  const cached = seen.get(obj);
  if (cached) return cached as T;

  if (Array.isArray(value)) {
    const arr: unknown[] = [];
    seen.set(obj, arr);
    for (const item of value) arr.push(cloneAny(item, seen));
    return arr as T;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (value instanceof RegExp) {
    const re = new RegExp(value.source, value.flags);
    re.lastIndex = value.lastIndex;
    return re as T;
  }

  if (value instanceof Map) {
    const map = new Map();
    seen.set(obj, map);
    for (const [k, v] of value.entries()) {
      map.set(cloneAny(k, seen), cloneAny(v, seen));
    }
    return map as T;
  }

  if (value instanceof Set) {
    const set = new Set();
    seen.set(obj, set);
    for (const v of value.values()) {
      set.add(cloneAny(v, seen));
    }
    return set as T;
  }

  const proto = Object.getPrototypeOf(value);
  const out = Object.create(proto);
  seen.set(obj, out);

  for (const key of Reflect.ownKeys(value as object)) {
    const desc = Object.getOwnPropertyDescriptor(value as object, key);
    if (!desc) continue;
    if ("value" in desc) {
      desc.value = cloneAny(desc.value, seen);
    }
    Object.defineProperty(out, key, desc);
  }

  return out as T;
}
