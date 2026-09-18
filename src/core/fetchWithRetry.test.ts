import { describe, expect, test } from "bun:test";
import { fetchWithRetry } from "./fetchWithRetry.ts";

describe("fetchWithRetry", () => {
  test("returns response immediately on successful fetch", async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const res = await fetchWithRetry("https://example.com/api", undefined, {
      fetcher: mockFetcher,
    });
    expect(res.status).toBe(200);
    expect(callCount).toBe(1);
  });

  test("retries on transient network error and succeeds", async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("fetch failed: ECONNRESET");
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const res = await fetchWithRetry("https://example.com/api", undefined, {
      backoffMs: 1,
      fetcher: mockFetcher,
      retries: 3,
    });
    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
  });

  test("retries on HTTP 429 and 500 responses", async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Too Many Requests", { status: 429 });
      }
      if (callCount === 2) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const res = await fetchWithRetry("https://example.com/api", undefined, {
      backoffMs: 1,
      fetcher: mockFetcher,
      retries: 3,
    });
    expect(res.status).toBe(200);
    expect(callCount).toBe(3);
  });

  test("does not retry on 404 client errors", async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      return new Response("Not Found", { status: 404 });
    };

    const res = await fetchWithRetry("https://example.com/api", undefined, {
      backoffMs: 1,
      fetcher: mockFetcher,
      retries: 3,
    });
    expect(res.status).toBe(404);
    expect(callCount).toBe(1);
  });

  test("throws when all retries are exhausted on network failure", async () => {
    let callCount = 0;
    const mockFetcher = async () => {
      callCount++;
      throw new Error("ETIMEDOUT");
    };

    await expect(
      fetchWithRetry("https://example.com/api", undefined, {
        backoffMs: 1,
        fetcher: mockFetcher,
        retries: 3,
      }),
    ).rejects.toThrow("ETIMEDOUT");
    expect(callCount).toBe(3);
  });
});
