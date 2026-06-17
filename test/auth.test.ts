import { test, expect } from "vitest";
import { authenticate } from "../src/auth";
import { sha256Hex } from "../src/store";

function req(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  return new Request("https://example.com/mcp", { headers });
}

test("no Authorization header -> not authed", async () => {
  const env = { MCP_TOKEN: "admin-secret", DB: {} } as any;
  expect(await authenticate(req(), env)).toEqual({ authed: false, isAdmin: false });
});

test("admin token -> admin, no email scope", async () => {
  const env = { MCP_TOKEN: "admin-secret", DB: {} } as any;
  expect(await authenticate(req("Bearer admin-secret"), env)).toEqual({
    authed: true,
    isAdmin: true,
  });
});

test("valid api key -> looked up by HASH (not plaintext), returns its email scope", async () => {
  const token = "sk-deadbeef";
  const expectedHash = await sha256Hex(token);
  let queried: string | undefined;
  const env = {
    MCP_TOKEN: "admin-secret",
    DB: {
      prepare: () => ({
        bind: (v: string) => {
          queried = v;
          return { first: async () => (v === expectedHash ? { email: "user@example.com" } : null) };
        },
      }),
    },
  } as any;

  const r = await authenticate(req(`Bearer ${token}`), env);
  expect(queried).toBe(expectedHash); // guards against reverting to plaintext lookup
  expect(r).toEqual({ authed: true, isAdmin: false, email: "user@example.com" });
});

test("unknown token -> not authed", async () => {
  const env = {
    MCP_TOKEN: "admin-secret",
    DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
  } as any;
  expect(await authenticate(req("Bearer sk-nope"), env)).toEqual({
    authed: false,
    isAdmin: false,
  });
});

test("DB error during key lookup fails closed (not authed)", async () => {
  const env = {
    MCP_TOKEN: "admin-secret",
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            throw new Error("db down");
          },
        }),
      }),
    },
  } as any;
  expect(await authenticate(req("Bearer sk-whatever"), env)).toEqual({
    authed: false,
    isAdmin: false,
  });
});
