import type { Env } from "./types";

const WEBHOOK_KEY = "webhook_url";

export async function getConfig(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare(`SELECT value FROM config WHERE key = ?`).bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setConfig(env: Env, key: string, value: string | null): Promise<void> {
  if (value == null || value === "") {
    await env.DB.prepare(`DELETE FROM config WHERE key = ?`).bind(key).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run();
}

export const getWebhook = (env: Env) => getConfig(env, WEBHOOK_KEY);
export const setWebhook = (env: Env, url: string | null) => setConfig(env, WEBHOOK_KEY, url);
