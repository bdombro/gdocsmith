/* Deterministic per-session key allocation for parsed (`o<N>`) and created (`n<N>`) model blocks/atoms. */

/**
 * Hands out deterministic, monotonically increasing keys within one parse/edit session:
 * `o<N>` for blocks/atoms read from existing JSON, `n<N>` for ones a step creates.
 * Two separate counters keep parsed and created keys from ever colliding.
 */
export class KeyAllocator {
  #counters: Record<"n" | "o", number> = { n: 0, o: 0 };

  /** Returns the next unused key for the given prefix. */
  next(
    /** `"o"` for a parsed (original) item, `"n"` for a newly created one. */
    prefix: "n" | "o",
  ): string {
    this.#counters[prefix] += 1;
    return `${prefix}${this.#counters[prefix]}`;
  }
}
