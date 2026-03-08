import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithTimeout, TimeoutError } from "./fetch-timeout";

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns response on successful fetch", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse);

    const result = await fetchWithTimeout("https://example.com", {
      timeoutMs: 5000,
    });

    expect(result).toBe(mockResponse);
    expect(result.status).toBe(200);
  });

  it("passes through request options to fetch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok"));

    await fetchWithTimeout("https://example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
      timeoutMs: 5000,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "value" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("does not include timeoutMs in fetch options", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok"));

    await fetchWithTimeout("https://example.com", { timeoutMs: 3000 });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[1]).not.toHaveProperty("timeoutMs");
  });

  it("throws TimeoutError when fetch exceeds timeout", async () => {
    vi.mocked(fetch).mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          const signal = (options as RequestInit).signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        }),
    );

    const promise = fetchWithTimeout("https://slow.example.com", {
      timeoutMs: 1000,
    });

    vi.advanceTimersByTime(1001);

    await expect(promise).rejects.toThrow(TimeoutError);
    await expect(promise).rejects.toThrow("timed out after 1000ms");
  });

  it("propagates network errors without wrapping as TimeoutError", async () => {
    const networkError = new TypeError("Failed to fetch");
    vi.mocked(fetch).mockRejectedValueOnce(networkError);

    const promise = fetchWithTimeout("https://down.example.com", {
      timeoutMs: 5000,
    });

    await expect(promise).rejects.toThrow(TypeError);
  });

  it("propagates DNS errors", async () => {
    const dnsError = new Error("getaddrinfo ENOTFOUND example.invalid");
    vi.mocked(fetch).mockRejectedValueOnce(dnsError);

    await expect(
      fetchWithTimeout("https://example.invalid", { timeoutMs: 5000 }),
    ).rejects.toThrow("getaddrinfo ENOTFOUND");
  });

  it("passes AbortController signal to fetch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok"));

    await fetchWithTimeout("https://example.com", { timeoutMs: 5000 });

    const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("clears timeout after successful fetch", async () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok"));

    await fetchWithTimeout("https://example.com", { timeoutMs: 5000 });

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("clears timeout after fetch error", async () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("oops"));

    await fetchWithTimeout("https://example.com", { timeoutMs: 5000 }).catch(
      () => {},
    );

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("works with HEAD method", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await fetchWithTimeout("https://example.com", {
      method: "HEAD",
      timeoutMs: 5000,
    });

    expect(result.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it("preserves response headers", async () => {
    const response = new Response("ok", {
      headers: { "X-Custom": "test-value", "Content-Type": "text/plain" },
    });
    vi.mocked(fetch).mockResolvedValueOnce(response);

    const result = await fetchWithTimeout("https://example.com", {
      timeoutMs: 5000,
    });

    expect(result.headers.get("X-Custom")).toBe("test-value");
  });
});

describe("TimeoutError", () => {
  it("has name 'TimeoutError'", () => {
    const err = new TimeoutError("https://example.com", 5000);
    expect(err.name).toBe("TimeoutError");
  });

  it("includes URL and timeout in message", () => {
    const err = new TimeoutError("https://api.example.com/health", 3000);
    expect(err.message).toContain("https://api.example.com/health");
    expect(err.message).toContain("3000");
  });

  it("is an instance of Error", () => {
    const err = new TimeoutError("https://example.com", 1000);
    expect(err).toBeInstanceOf(Error);
  });
});
