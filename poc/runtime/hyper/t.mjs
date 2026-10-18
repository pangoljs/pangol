// Schema builder. Plain descriptors only: the build step turns them into straight-line code.
export const t = {
  object: (shape) => ({ kind: 'object', shape }),
  string: (o = {}) => ({ kind: 'string', min: o.min ?? 0, max: o.max ?? 10_000, pattern: o.pattern }),
  email: (o = {}) => ({ kind: 'email', max: o.max ?? 254 }),
  bool: () => ({ kind: 'bool' }),
  int: (o = {}) => ({ kind: 'int', min: o.min ?? Number.MIN_SAFE_INTEGER, max: o.max ?? Number.MAX_SAFE_INTEGER }),
}

// Route definition helper (identity at runtime; the build step reads these objects).
export const route = (def) => def
export const defineAuth = (def) => def
