import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE;
const TOKEN = process.env.TOKEN;

const health = await fetch(`${BASE}/health`);
console.log("health:", health.status, await health.text());

const noAuth = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
});
console.log("no-token:", noAuth.status, noAuth.status === 401 ? "OK(401)" : "UNEXPECTED");

const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
});
const client = new Client({ name: "remote-check", version: "0.0.1" });
await client.connect(transport);
console.log("connected:", client.getServerVersion());
const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).sort().join(", "));
const call = async (n, a = {}) => JSON.parse((await client.callTool({ name: n, arguments: a })).content[0].text);
console.log("stats:", await call("stats"));
console.log("get_webhook:", await call("get_webhook"));
await client.close();
console.log("REMOTE_OK");
