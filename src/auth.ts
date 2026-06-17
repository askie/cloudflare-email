import { sha256Hex } from "./store";
import type { Env } from "./types";

export interface AuthResult {
  authed: boolean;
  isAdmin: boolean;
  email?: string;
}

// Resolve a Bearer token to an identity. The admin token (env.MCP_TOKEN) grants
// full access; any other token is looked up in api_keys by its SHA-256 hash and
// scoped to a single email. Fails closed on any error.
export async function authenticate(request: Request, env: Env): Promise<AuthResult> {
  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return { authed: false, isAdmin: false };
  const token = m[1];

  // 1. Check admin token
  if (env.MCP_TOKEN && token === env.MCP_TOKEN) {
    return { authed: true, isAdmin: true };
  }

  // 2. Check api_keys table in D1 (keys are stored as SHA-256 hashes).
  try {
    const hash = await sha256Hex(token);
    const r = await env.DB.prepare(
      `SELECT email FROM api_keys WHERE key_value = ?`
    ).bind(hash).first<{ email: string }>();
    if (r && r.email) {
      return { authed: true, isAdmin: false, email: r.email };
    }
  } catch (e) {
    console.error("Auth DB error:", e);
  }

  return { authed: false, isAdmin: false };
}
