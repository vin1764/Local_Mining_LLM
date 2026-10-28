/**
 * A small JSON API so the GitHub Pages edition can use the AI analyst that
 * runs on this computer (Node app + Ollama). Routes:
 *
 *   GET  /api/local-ai/status
 *   POST /api/local-ai/analyze   (body: dataset profile JSON)
 *
 * Security:
 * - Only requests addressed to localhost are served (Host check).
 * - Cross-origin browser requests are refused unless the page's origin is
 *   listed exactly in CORS_ALLOWED_ORIGINS (or --allow-origin). No wildcard.
 * - POST requires Content-Type: application/json, so other websites cannot
 *   send it without a CORS preflight, which they fail.
 * - Bodies are capped at 1 MB. The API only analyses a statistics profile;
 *   it is not a proxy and cannot read files.
 */
import { isAllowedHost, MAX_SERVER_FN_BODY_BYTES } from "./local-guard";

export const LOCAL_API_PREFIX = "/api/local-ai/";

/** Exact origins (scheme://host[:port]) allowed to call the API from a browser. */
export function allowedOrigins(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return (env["CORS_ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => {
      if (!o || o === "*" || o === "null") return false;
      try {
        const u = new URL(o);
        return (
          (u.protocol === "https:" || u.protocol === "http:") && u.origin === o
        );
      } catch {
        return false;
      }
    });
}

function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function handleLocalApi(
  request: Request,
  deps: {
    analyze: (input: unknown, signal: AbortSignal) => Promise<unknown>;
    status: () => Promise<unknown>;
    env?: Record<string, string | undefined>;
  },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(LOCAL_API_PREFIX)) return null;
  const env = deps.env ?? process.env;

  if (!isAllowedHost(request.headers.get("host"), env)) {
    return json(
      { error: "This API only accepts requests addressed to localhost." },
      403,
    );
  }

  const origin = request.headers.get("origin");
  const self = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  const crossOrigin = origin !== null && origin !== self;
  if (crossOrigin && !allowedOrigins(env).includes(origin)) {
    return json(
      {
        error: `Origin ${origin} is not allowed.`,
        hint: "Start the local app with CORS_ALLOWED_ORIGINS set to this page's origin (see README).",
      },
      403,
    );
  }
  const cors: Record<string, string> = crossOrigin
    ? { "access-control-allow-origin": origin!, vary: "Origin" }
    : {};

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
        // Chrome's Private Network Access preflight for public → localhost requests.
        ...(request.headers.get("access-control-request-private-network") ===
        "true"
          ? { "access-control-allow-private-network": "true" }
          : {}),
      },
    });
  }

  const route = url.pathname.slice(LOCAL_API_PREFIX.length);

  if (route === "status" && request.method === "GET") {
    return json(await deps.status(), 200, cors);
  }

  if (route === "analyze" && request.method === "POST") {
    const type = request.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/json")) {
      return json(
        { error: "Content-Type must be application/json." },
        415,
        cors,
      );
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_SERVER_FN_BODY_BYTES) {
      return json({ error: "Payload too large." }, 413, cors);
    }
    const text = await request.text();
    if (text.length > MAX_SERVER_FN_BODY_BYTES)
      return json({ error: "Payload too large." }, 413, cors);
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return json({ error: "Body is not valid JSON." }, 400, cors);
    }
    return json(await deps.analyze(input, request.signal), 200, cors);
  }

  return json({ error: "Not found." }, 404, cors);
}
