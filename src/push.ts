import type { Env, EmailRow } from "./types";
import { getWebhook } from "./config";

// POST a compact "new email" event to the configured webhook (if any).
// Best-effort: failures are logged, never block ingestion.
export async function pushNewEmail(env: Env, row: EmailRow): Promise<void> {
  const url = await getWebhook(env);
  if (!url) return;

  const payload = {
    type: "email.received",
    id: row.id,
    from: row.from_addr,
    from_name: row.from_name,
    to: row.to_addr,
    subject: row.subject,
    date: row.date,
    has_attachments: !!row.has_attachments,
    snippet: row.text_body ? row.text_body.replace(/\s+/g, " ").trim().slice(0, 280) : null,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`webhook push failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error("webhook push error:", err);
  }
}
