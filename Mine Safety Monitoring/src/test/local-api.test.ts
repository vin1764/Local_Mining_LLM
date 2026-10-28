// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { allowedOrigins, handleLocalApi } from "@/lib/local-api.server";

const PAGES = "https://vin1764.github.io";
const env = { CORS_ALLOWED_ORIGINS: PAGES };
const deps = (e: Record<string, string | undefined> = env) => ({
  analyze: vi.fn(async () => ({ ok: true, insights: {}, meta: {} })),
  status: vi.fn(async () => ({ reachable: true, modelInstalled: true })),
  env: e,
});
const req = (
  path: string,
  init: RequestInit & { origin?: string; host?: string } = {},
) => {
  const headers = new Headers(init.headers);
  headers.set("host", init.host ?? "127.0.0.1:8080");
  if (init.origin) headers.set("origin", init.origin);
  return new Request(`http://127.0.0.1:8080${path}`, { ...init, headers });
};

describe("local AI API (GitHub Pages bridge)", () => {
  it("ignores other paths", async () => {
    expect(await handleLocalApi(req("/"), deps())).toBeNull();
  });

  it("answers the allowed Pages origin with an exact CORS header", async () => {
    const res = (await handleLocalApi(
      req("/api/local-ai/status", { origin: PAGES }),
      deps(),
    ))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGES);
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("refuses origins that are not configured (default: none)", async () => {
    const d = deps({});
    const res = (await handleLocalApi(
      req("/api/local-ai/status", { origin: PAGES }),
      d,
    ))!;
    expect(res.status).toBe(403);
    expect(d.status).not.toHaveBeenCalled();
    const evil = (await handleLocalApi(
      req("/api/local-ai/analyze", {
        method: "POST",
        origin: "https://evil.example",
      }),
      deps(),
    ))!;
    expect(evil.status).toBe(403);
  });

  it("refuses requests addressed to a non-local host (DNS rebinding)", async () => {
    const res = (await handleLocalApi(
      req("/api/local-ai/status", { host: "attacker.example" }),
      deps(),
    ))!;
    expect(res.status).toBe(403);
  });

  it("answers the CORS + private-network preflight for the allowed origin", async () => {
    const res = (await handleLocalApi(
      req("/api/local-ai/analyze", {
        method: "OPTIONS",
        origin: PAGES,
        headers: { "access-control-request-private-network": "true" },
      }),
      deps(),
    ))!;
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-private-network")).toBe(
      "true",
    );
    expect(res.headers.get("access-control-allow-headers")).toBe(
      "content-type",
    );
  });

  it("only accepts JSON bodies and passes them to the analyst", async () => {
    const d = deps();
    const text = await handleLocalApi(
      req("/api/local-ai/analyze", {
        method: "POST",
        origin: PAGES,
        body: "x",
        headers: { "content-type": "text/plain" },
      }),
      d,
    );
    expect(text!.status).toBe(415);
    const ok = await handleLocalApi(
      req("/api/local-ai/analyze", {
        method: "POST",
        origin: PAGES,
        body: JSON.stringify({ name: "x" }),
        headers: { "content-type": "application/json" },
      }),
      d,
    );
    expect(ok!.status).toBe(200);
    expect(d.analyze).toHaveBeenCalledWith({ name: "x" }, expect.anything());
    const bad = await handleLocalApi(
      req("/api/local-ai/analyze", {
        method: "POST",
        body: "{nope",
        headers: { "content-type": "application/json" },
      }),
      d,
    );
    expect(bad!.status).toBe(400);
  });

  it("rejects oversized bodies", async () => {
    const res = await handleLocalApi(
      req("/api/local-ai/analyze", {
        method: "POST",
        origin: PAGES,
        body: "x".repeat(1024 * 1024 + 10),
        headers: { "content-type": "application/json" },
      }),
      deps(),
    );
    expect(res!.status).toBe(413);
  });

  it("parses the allowlist strictly (no wildcard, no paths)", () => {
    expect(
      allowedOrigins({
        CORS_ALLOWED_ORIGINS: `${PAGES}/, *, null, https://a.example/path, ftp://x, http://127.0.0.1:5173`,
      }),
    ).toEqual([PAGES, "http://127.0.0.1:5173"]);
  });
});
