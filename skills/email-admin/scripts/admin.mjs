#!/usr/bin/env node
// admin.mjs — administer a cloudflare-email service with the ADMIN key.
//
// The admin key is the service's MCP_TOKEN. It unlocks management tools that
// ordinary per-mailbox keys never see: open a mailbox (create a key bound to an
// address), list/revoke keys, and configure the new-email webhook.
//
// Zero dependencies: built-in fetch (Node 18+). Speaks the MCP Streamable HTTP
// handshake by hand so the skill works in any agent without the MCP SDK.
//
// Config lives in one JSON file (separate from the user-side email-inbox config):
//   { "base": "https://mail.example.com", "key": "<admin MCP_TOKEN>" }
// Path: EMAIL_ADMIN_CONFIG, else $XDG_CONFIG_HOME/email-admin/config.json,
// else ~/.config/email-admin/config.json.
// Env EMAIL_ADMIN_BASE / EMAIL_ADMIN_KEY override the file.
//
// Commands:
//   node admin.mjs setup   --base <url> --key <admin-token>   # save + verify admin access
//   node admin.mjs create-key --email <addr>                  # open a mailbox, print its key ONCE
//   node admin.mjs list-keys                                  # list mailboxes that have a key
//   node admin.mjs delete-key --email <addr>                  # revoke a mailbox's key
//   node admin.mjs get-webhook                                # show new-email webhook URL
//   node admin.mjs set-webhook --url <url|"">                 # set/clear new-email webhook
//   add --json to any read command for machine-readable output

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---- config -----------------------------------------------------------------

function resolveConfigPath() {
  if (process.env.EMAIL_ADMIN_CONFIG) return process.env.EMAIL_ADMIN_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "email-admin", "config.json");
}

function loadConfig(path) {
  let cfg = {};
  if (existsSync(path)) {
    try { cfg = JSON.parse(readFileSync(path, "utf8")); }
    catch (e) { fail(`config file is not valid JSON: ${path}\n${e.message}`); }
  }
  cfg.base = (process.env.EMAIL_ADMIN_BASE || cfg.base || "").replace(/\/+$/, "");
  cfg.key = process.env.EMAIL_ADMIN_KEY || cfg.key || "";
  return cfg;
}

function saveConfig(path, base, key) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ base, key }, null, 2) + "\n");
}

// ---- MCP Streamable HTTP client (hand-rolled, no SDK) ------------------------

function parseRpcBody(contentType, text) {
  if (contentType.includes("text/event-stream")) {
    const msgs = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^data:\s?(.*)$/);
      if (m && m[1].trim()) { try { msgs.push(JSON.parse(m[1])); } catch { /* keep-alive */ } }
    }
    return msgs;
  }
  const t = text.trim();
  if (!t) return [];
  const parsed = JSON.parse(t);
  return Array.isArray(parsed) ? parsed : [parsed];
}

class McpClient {
  constructor(base, key) {
    this.url = `${base}/mcp`;
    this.key = key;
    this.sessionId = null;
    this.id = 0;
  }

  async post(payload) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${this.key}`,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const res = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(payload) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (res.status === 401) fail("authentication failed (401): the admin key was rejected.");
    const text = await res.text();
    if (!res.ok) fail(`server returned HTTP ${res.status}: ${text.slice(0, 300)}`);
    return parseRpcBody(res.headers.get("content-type") || "", text);
  }

  async request(method, params) {
    const id = ++this.id;
    const msgs = await this.post({ jsonrpc: "2.0", id, method, params });
    const msg = msgs.find((m) => m.id === id) ?? msgs[0];
    if (!msg) fail(`no response to ${method}`);
    if (msg.error) fail(`${method} error: ${msg.error.message || JSON.stringify(msg.error)}`);
    return msg.result;
  }

  async notify(method, params) {
    await this.post({ jsonrpc: "2.0", method, params });
  }

  async connect() {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "email-admin-skill", version: "1.0.0" },
    });
    await this.notify("notifications/initialized", {});
  }

  // Returns the set of tool names the current identity can see. Admin keys see
  // the management tools; ordinary mailbox keys do not.
  async toolNames() {
    const r = await this.request("tools/list", {});
    return new Set((r?.tools || []).map((t) => t.name));
  }

  async callTool(name, args) {
    const result = await this.request("tools/call", { name, arguments: args });
    const block = (result?.content || []).find((c) => c.type === "text");
    if (!block) return null;
    const data = JSON.parse(block.text);
    // Tools report their own permission failures in-band; surface them as errors.
    if (data && data.error) fail(String(data.error));
    return data;
  }
}

const ADMIN_TOOL = "create_api_key"; // presence in tools/list ⇒ admin identity

// ---- helpers -----------------------------------------------------------------

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function parseFlags(argv) {
  const f = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--json") f.json = true;
    else if (k === "--base") f.base = argv[++i];
    else if (k === "--key") f.key = argv[++i];
    else if (k === "--email") f.email = argv[++i];
    else if (k === "--url") f.url = argv[++i] ?? "";
    else if (k === "--help" || k === "-h") f.help = true;
    else if (k.startsWith("--")) fail(`unknown flag: ${k}`);
    else f._.push(k);
  }
  return f;
}

function printHelp() {
  process.stdout.write(
    `admin.mjs — administer a cloudflare-email service with the admin key\n\n` +
    `  setup --base <url> --key <admin-token>   save config and verify admin access\n` +
    `  create-key --email <addr>                open a mailbox; prints its key ONCE\n` +
    `  list-keys                                list mailboxes that have a key\n` +
    `  delete-key --email <addr>                revoke a mailbox's key\n` +
    `  get-webhook                              show the new-email webhook URL\n` +
    `  set-webhook --url <url|"">               set or clear the new-email webhook\n\n` +
    `  add --json to read commands for machine-readable output\n`
  );
}

function out(json, human, data) {
  if (json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(human + "\n");
}

async function connectAdmin(cfg, { requireAdmin = true } = {}) {
  if (!cfg.base) fail(`no service URL. Run "setup" first, or set EMAIL_ADMIN_BASE.`);
  if (!cfg.key) fail(`no admin key. Run "setup" first, or set EMAIL_ADMIN_KEY.`);
  const client = new McpClient(cfg.base, cfg.key);
  await client.connect();
  if (requireAdmin) {
    const tools = await client.toolNames();
    if (!tools.has(ADMIN_TOOL)) {
      fail("this key is not an admin key (no management tools available). Use the service's MCP_TOKEN.");
    }
  }
  return client;
}

// ---- commands ----------------------------------------------------------------

async function cmdSetup(f, cfgPath, cfg) {
  const base = (f.base || cfg.base || "").replace(/\/+$/, "");
  const key = f.key || cfg.key || "";
  if (!base) fail("missing --base (the service URL, e.g. https://mail.example.com)");
  if (!key) fail("missing --key (the admin MCP_TOKEN)");
  process.stdout.write(`Verifying admin access to ${base} ...\n`);
  const client = new McpClient(base, key);
  await client.connect();
  const tools = await client.toolNames();
  if (!tools.has(ADMIN_TOOL)) {
    fail("connected, but this key is NOT an admin key (no management tools). Use the service's MCP_TOKEN.");
  }
  saveConfig(cfgPath, base, key);
  process.stdout.write(
    `\n✅ Admin access confirmed.\n` +
    `   Management tools: ${[...tools].filter((t) => /api_key|webhook/.test(t)).sort().join(", ")}\n` +
    `   Config saved to: ${cfgPath}\n\n` +
    `Next:  node admin.mjs create-key --email someone@yourdomain.com\n`
  );
}

async function cmdCreateKey(f, cfg) {
  if (!f.email) fail("missing --email (the address to open a mailbox for)");
  const client = await connectAdmin(cfg);
  const r = await client.callTool("create_api_key", { email: f.email });
  if (f.json) { out(true, "", r); return; }
  process.stdout.write(
    `\n✅ Mailbox opened for ${r.email}\n\n` +
    `   API Key (shown ONCE — copy it now, it cannot be retrieved later):\n\n` +
    `      ${r.api_key}\n\n` +
    `   Give this key to the user. They configure it with the email-inbox skill:\n` +
    `      node setup.mjs --base ${cfg.base} --email ${r.email} --key ${r.api_key}\n`
  );
}

async function cmdListKeys(f, cfg) {
  const client = await connectAdmin(cfg);
  const r = await client.callTool("list_api_keys", {});
  const keys = r?.keys || [];
  if (f.json) { out(true, "", { keys }); return; }
  if (!keys.length) { process.stdout.write("还没有开通任何邮箱（没有 Key）。\n"); return; }
  process.stdout.write(`已开通 ${keys.length} 个邮箱：\n\n`);
  for (const k of keys) {
    const when = k.created_at ? new Date(k.created_at).toISOString().slice(0, 16).replace("T", " ") : "?";
    process.stdout.write(`• ${k.email}   （创建于 ${when}）\n`);
  }
  process.stdout.write(`\n注：只能看到绑定的邮箱地址；Key 本身以哈希存储，无法回看。\n`);
}

async function cmdDeleteKey(f, cfg) {
  if (!f.email) fail("missing --email (the mailbox whose key to revoke)");
  const client = await connectAdmin(cfg);
  const r = await client.callTool("delete_api_key", { email: f.email });
  if (f.json) { out(true, "", r); return; }
  if (r?.ok) process.stdout.write(`✅ 已吊销 ${f.email} 的 Key（该 Key 立即失效）。\n`);
  else process.stdout.write(`未找到 ${f.email} 对应的 Key，无需吊销。\n`);
}

async function cmdGetWebhook(f, cfg) {
  const client = await connectAdmin(cfg);
  const r = await client.callTool("get_webhook", {});
  if (f.json) { out(true, "", r); return; }
  process.stdout.write(r?.webhook_url ? `新邮件通知地址：${r.webhook_url}\n` : `未设置新邮件通知地址。\n`);
}

async function cmdSetWebhook(f, cfg) {
  if (f.url === undefined) fail('missing --url (use --url "" to clear)');
  const client = await connectAdmin(cfg);
  const r = await client.callTool("set_webhook", { url: f.url });
  if (f.json) { out(true, "", r); return; }
  if (r?.ok === false) fail(r.error || "set_webhook failed");
  process.stdout.write(r?.webhook_url ? `✅ 新邮件将通知到：${r.webhook_url}\n` : `✅ 已清除新邮件通知。\n`);
}

// ---- main --------------------------------------------------------------------

async function main() {
  const f = parseFlags(process.argv.slice(2));
  if (f.help || f._.length === 0) { printHelp(); process.exit(f.help ? 0 : 1); }
  const cmd = f._[0];
  const cfgPath = resolveConfigPath();
  const cfg = loadConfig(cfgPath);

  switch (cmd) {
    case "setup": return cmdSetup(f, cfgPath, cfg);
    case "create-key": return cmdCreateKey(f, cfg);
    case "list-keys": return cmdListKeys(f, cfg);
    case "delete-key": return cmdDeleteKey(f, cfg);
    case "get-webhook": return cmdGetWebhook(f, cfg);
    case "set-webhook": return cmdSetWebhook(f, cfg);
    default: fail(`unknown command: ${cmd}\nRun with --help for usage.`);
  }
}

main().catch((e) => fail(e.message || String(e)));
