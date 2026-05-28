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
  if (!errs) return null;
  if (typeof errs === 'object') {
    const o = errs as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
    if (Array.isArray(errs)) {
      for (const child of errs) {
        const m = firstErrorMessage(child);
        if (m) return m;
      }
      return null;
    }
    for (const k of Object.keys(o)) {
      const m = firstErrorMessage(o[k]);
      if (m) return m;
    }
  }
  return null;
}
