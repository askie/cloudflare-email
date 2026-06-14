import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_MCP = process.env.BASE ? `${process.env.BASE}/mcp` : "http://127.0.0.1:8787/mcp";
const TOKEN = process.env.MCP_TOKEN || "testtoken123"; // local-dev default; matches .dev.vars.example

// 1) auth must reject missing token
const noAuth = await fetch(URL_MCP, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
});
console.log("no-token status:", noAuth.status, noAuth.status === 401 ? "OK(401)" : "UNEXPECTED");

// 2) connect with token
const transport = new StreamableHTTPClientTransport(new global.URL(URL_MCP), {
  requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
});
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);
console.log("connected:", client.getServerVersion());

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).sort().join(", "));

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return JSON.parse(r.content[0].text);
};

console.log("set_webhook:", await call("set_webhook", { url: "https://example.com/hook" }));
console.log("get_webhook:", await call("get_webhook"));
console.log("set_webhook(bad):", await call("set_webhook", { url: "ftp://nope" }));
console.log("stats:", await call("stats"));
console.log("search_emails:", await call("search_emails", { query: "invoice" }));
console.log("list_emails:", await call("list_emails", { limit: 5 }));

await client.close();
console.log("DONE");
