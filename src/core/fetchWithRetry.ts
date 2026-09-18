/* HTTP fetch wrapper providing automatic retries and exponential backoff for transient errors. */

import { type ApiFetcher, fetchGoogleApi } from "./gws.ts";

/**
 * Options configuring retry count and backoff timing for network fetch operations.
 */
export interface FetchRetryOptions {
  /** Initial backoff delay in milliseconds. Defaults to 500ms. */
  backoffMs?: number;
  /** Custom fetcher function. Defaults to fetchGoogleApi. */
  fetcher?: ApiFetcher;
  /** Maximum number of retry attempts. Defaults to 3. */
  retries?: number;
}

/**
 * Executes an HTTP fetch request with automatic retries and exponential backoff on transient errors.
 */
export async function fetchWithRetry(
  /** Request URL to fetch. */
  url: string,
  /** Standard fetch RequestInit options. */
  init?: RequestInit,
  /** Retry configuration options. */
  options: FetchRetryOptions = {},
): Promise<Response> {
  const { backoffMs = 500, fetcher = fetchGoogleApi, retries = 3 } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetcher(url, init);
      // Retry on 429 rate-limiting and 5xx server errors (except 501 Not Implemented)
      if ((res.status === 429 || (res.status >= 500 && res.status !== 501)) && attempt < retries - 1) {
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

  if (lastError) throw lastError;
  throw new Error(`Fetch failed after ${retries} attempts: ${url}`);
}

/**
 * Detects whether a network or fetch error is transient and safe to retry.
 */
function isTransientError(
  /** Error object or primitive to inspect. */
  err: unknown,
): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /HTTP request failed|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|network timeout/i.test(msg);
}

/**
 * Pauses execution for the specified milliseconds.
 */
function sleep(
  /** Duration in milliseconds. */
  ms: number,
): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
