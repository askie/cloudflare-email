import { EmailMCP } from "./mcp";
import { ingest } from "./email";
import { authenticate } from "./auth";
import type { Env } from "./types";

// Durable Object class backing the MCP session (referenced by wrangler.jsonc).
export { EmailMCP };

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Bearer realm="mcp"' },
  });
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
      const auth = await authenticate(request, env);
      if (!auth.authed) return unauthorized();

      const headers = new Headers(request.headers);
      if (auth.email) {
        headers.set("x-user-email", auth.email);
      }
      headers.set("x-is-admin", auth.isAdmin ? "true" : "false");

      const authedRequest = new Request(request, { headers });

      if (url.pathname === "/mcp") {
        return EmailMCP.serve("/mcp").fetch(authedRequest, env, ctx);
      }
      return EmailMCP.serveSSE("/sse").fetch(authedRequest, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
