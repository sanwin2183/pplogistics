/**
 * Walk a (possibly nested) react-hook-form errors tree and return the first
 * `message` string we find. Used to surface validation failures as a toast
 * — better than letting a Save button do "nothing" because the inline error
 * is off-screen on a small phone.
 *
 * Pair with handleSubmit's onInvalid:
 *
 *   const onSubmit = handleSubmit(
 *     async (data) => { ... },
 *     (errs) => toast.error(firstErrorMessage(errs) ?? 'Please fix the highlighted fields'),
 *   );
 */
export function firstErrorMessage(errs: unknown): string | null {
  const hit = firstFieldError(errs);
  return hit?.message ?? null;
}

/** Where in the form tree the first error lives. Numeric keys = array index. */
export type FieldErrorHit = { message: string; path: (string | number)[] };

/**
 * Like firstErrorMessage but also returns the PATH to the offending node so
 * the caller can:
 *   1. Build a field-named toast ("Item 2: Category is required") via a
 *      project-specific path → label mapper, instead of a bare "Required".
 *   2. Scroll the user to the offending row.
 *
 * The walker skips RHF's per-leaf metadata (`ref`, `type`, `types`) so we
 * don't traverse the DOM-element ref or report internal-state nodes as
 * errors. Arrays push numeric indices into the path so callers can render
 * "Item N" / "Flyer assignment N" with N = index + 1.
 */
export function firstFieldError(errs: unknown): FieldErrorHit | null {
  return walk(errs, []);
}

function walk(node: unknown, path: (string | number)[]): FieldErrorHit | null {
  if (!node || typeof node !== 'object') return null;
  const o = node as Record<string, unknown>;
  // Leaf — RHF error nodes have a string `message`.
  if (typeof o.message === 'string') return { message: o.message, path };
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const m = walk(node[i], [...path, i]);
      if (m) return m;
    }
    return null;
  }
  for (const k of Object.keys(o)) {
    // Skip RHF metadata that lives alongside child error nodes.
    if (k === 'ref' || k === 'type' || k === 'types') continue;
    const m = walk(o[k], [...path, k]);
    if (m) return m;
  }
  return null;
}
