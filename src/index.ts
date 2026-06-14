import { EmailMCP } from "./mcp";
import { ingest } from "./email";
import type { Env } from "./types";

// Durable Object class backing the MCP session (referenced by wrangler.jsonc).
export { EmailMCP };

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Bearer realm="mcp"' },
  });
}

function isAuthed(request: Request, env: Env): boolean {
  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return !!m && !!env.MCP_TOKEN && m[1] === env.MCP_TOKEN;
}

export default {
  // Inbound mail (Cloudflare Email Routing).
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    await ingest(message, env, ctx);
  },

  // HTTP: MCP endpoint (token-gated) + health check.
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    if (url.pathname === "/mcp" || url.pathname === "/sse" || url.pathname === "/sse/message") {
      if (!isAuthed(request, env)) return unauthorized();
      if (url.pathname === "/mcp") {
        return EmailMCP.serve("/mcp").fetch(request, env, ctx);
      }
      return EmailMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
