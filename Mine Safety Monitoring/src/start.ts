import {
  createStart,
  createCsrfMiddleware,
  createMiddleware,
} from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { isAllowedHost, MAX_SERVER_FN_BODY_BYTES } from "./lib/local-guard";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Local-only guard: refuse requests whose Host header is not this computer
// (protects against DNS-rebinding pages in the browser), and cap the size of
// server-function payloads.
const localGuardMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    if (!isAllowedHost(request.headers.get("host"), process.env)) {
      return new Response(
        "Forbidden: this app only accepts requests addressed to localhost.",
        {
          status: 403,
          headers: { "content-type": "text/plain; charset=utf-8" },
        },
      );
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_SERVER_FN_BODY_BYTES) {
      return new Response("Payload too large.", { status: 413 });
    }
    return next();
  },
);

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [localGuardMiddleware, errorMiddleware, csrfMiddleware],
}));
