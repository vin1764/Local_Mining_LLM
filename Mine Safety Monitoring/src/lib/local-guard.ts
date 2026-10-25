/** Server functions only receive a compact statistical profile, never raw CSV. */
export const MAX_SERVER_FN_BODY_BYTES = 1024 * 1024;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.lastIndexOf(":");
  return colon === -1 ? h : h.slice(0, colon);
}

/**
 * True when the Host header names this computer (or a host listed in
 * ALLOWED_HOSTS). A missing Host header is rejected.
 */
export function isAllowedHost(
  hostHeader: string | null | undefined,
  env: Record<string, string | undefined> = {},
): boolean {
  if (!hostHeader) return false;
  const hostname = hostnameOf(hostHeader);
  if (LOCAL_HOSTNAMES.has(hostname)) return true;
  const extra = (env["ALLOWED_HOSTS"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(hostname);
}
