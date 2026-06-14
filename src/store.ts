import type { Env, EmailRow, ParsedEmail, StoredAttachment } from "./types";

function safeName(name: string | null): string {
  return (name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

function snippet(text: string | null, len = 200): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > len ? t.slice(0, len) + "…" : t;
}

// Persist a parsed email: raw + html + attachments -> R2, metadata + FTS + attachment rows -> D1.
export async function storeEmail(
  env: Env,
  rawBuf: ArrayBuffer,
  parsed: ParsedEmail
): Promise<EmailRow> {
  const id = crypto.randomUUID();
  const received_at = Date.now();
  const date = parsed.date ?? received_at;

  const rawKey = `raw/${id}.eml`;
  await env.BUCKET.put(rawKey, rawBuf, {
    httpMetadata: { contentType: "message/rfc822" },
  });

  let htmlKey: string | null = null;
  if (parsed.html_body) {
    htmlKey = `html/${id}.html`;
    await env.BUCKET.put(htmlKey, parsed.html_body, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
    });
  }

  const attachments: StoredAttachment[] = [];
  for (const a of parsed.attachments) {
    const aid = crypto.randomUUID();
    const key = `att/${id}/${aid}-${safeName(a.filename)}`;
    await env.BUCKET.put(key, a.content, {
      httpMetadata: { contentType: a.content_type || "application/octet-stream" },
    });
    attachments.push({
      id: aid,
      email_id: id,
      filename: a.filename,
      content_type: a.content_type,
      size: a.content.byteLength,
      r2_key: key,
    });
  }

  const row: EmailRow = {
    id,
    msg_id: parsed.msg_id,
    from_addr: parsed.from_addr,
    from_name: parsed.from_name,
    to_addr: parsed.to_addr,
    cc_addr: parsed.cc_addr,
    subject: parsed.subject,
    date,
    text_body: parsed.text_body,
    html_key: htmlKey,
    raw_key: rawKey,
    size: rawBuf.byteLength,
    has_attachments: attachments.length > 0 ? 1 : 0,
    received_at,
  };

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO emails
         (id, msg_id, from_addr, from_name, to_addr, cc_addr, subject, date,
          text_body, html_key, raw_key, size, has_attachments, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      row.id, row.msg_id, row.from_addr, row.from_name, row.to_addr, row.cc_addr,
      row.subject, row.date, row.text_body, row.html_key, row.raw_key, row.size,
      row.has_attachments, row.received_at
    ),
    env.DB.prepare(
      `INSERT INTO emails_fts (email_id, subject, text_body) VALUES (?,?,?)`
    ).bind(row.id, row.subject ?? "", row.text_body ?? ""),
    ...attachments.map((a) =>
      env.DB.prepare(
        `INSERT INTO attachments (id, email_id, filename, content_type, size, r2_key)
         VALUES (?,?,?,?,?,?)`
      ).bind(a.id, a.email_id, a.filename, a.content_type, a.size, a.r2_key)
    ),
  ];
  await env.DB.batch(stmts);

  return row;
}

export interface ListFilters {
  from?: string;
  to?: string;
  subject?: string;
  since?: number; // epoch ms inclusive
  until?: number; // epoch ms inclusive
  limit?: number;
  offset?: number;
}

// Lightweight metadata row returned to the AI (no full body).
function summarize(r: any) {
  return {
    id: r.id,
    from: r.from_addr,
    from_name: r.from_name,
    to: r.to_addr,
    subject: r.subject,
    date: r.date,
    has_attachments: !!r.has_attachments,
    snippet: snippet(r.text_body),
  };
}

export async function listEmails(env: Env, f: ListFilters) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.from) { where.push("from_addr LIKE ?"); args.push(`%${f.from}%`); }
  if (f.to) { where.push("to_addr LIKE ?"); args.push(`%${f.to}%`); }
  if (f.subject) { where.push("subject LIKE ?"); args.push(`%${f.subject}%`); }
  if (f.since != null) { where.push("date >= ?"); args.push(f.since); }
  if (f.until != null) { where.push("date <= ?"); args.push(f.until); }

  const limit = Math.min(Math.max(f.limit ?? 20, 1), 100);
  const offset = Math.max(f.offset ?? 0, 0);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const res = await env.DB.prepare(
    `SELECT id, from_addr, from_name, to_addr, subject, date, has_attachments, text_body
       FROM emails ${clause}
       ORDER BY date DESC
       LIMIT ? OFFSET ?`
  ).bind(...args, limit, offset).all();

  const rows = (res.results ?? []).map(summarize);
  return {
    emails: rows,
    next_offset: rows.length === limit ? offset + limit : null,
  };
}

export async function searchEmails(env: Env, query: string, limit = 20) {
  const lim = Math.min(Math.max(limit, 1), 100);
  const q = query.trim();
  if (q.length < 3) {
    // trigram needs >=3 chars; fall back to substring match.
    const res = await env.DB.prepare(
      `SELECT id, from_addr, from_name, to_addr, subject, date, has_attachments, text_body
         FROM emails
         WHERE subject LIKE ? OR text_body LIKE ?
         ORDER BY date DESC LIMIT ?`
    ).bind(`%${q}%`, `%${q}%`, lim).all();
    return { emails: (res.results ?? []).map(summarize) };
  }
  const res = await env.DB.prepare(
    `SELECT e.id, e.from_addr, e.from_name, e.to_addr, e.subject, e.date,
            e.has_attachments,
            snippet(emails_fts, 2, '[', ']', '…', 12) AS snip
       FROM emails_fts f
       JOIN emails e ON e.id = f.email_id
       WHERE emails_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
  ).bind(q, lim).all();
  const rows = (res.results ?? []).map((r: any) => ({
    id: r.id,
    from: r.from_addr,
    from_name: r.from_name,
    to: r.to_addr,
    subject: r.subject,
    date: r.date,
    has_attachments: !!r.has_attachments,
    snippet: r.snip,
  }));
  return { emails: rows };
}

export async function getEmail(env: Env, id: string, includeHtml = false) {
  const r = await env.DB.prepare(`SELECT * FROM emails WHERE id = ?`).bind(id).first<EmailRow>();
  if (!r) return null;
  const atts = await env.DB.prepare(
    `SELECT id, filename, content_type, size FROM attachments WHERE email_id = ?`
  ).bind(id).all();

  let html: string | null = null;
  if (includeHtml && r.html_key) {
    const obj = await env.BUCKET.get(r.html_key);
    html = obj ? await obj.text() : null;
  }

  return {
    id: r.id,
    msg_id: r.msg_id,
    from: r.from_addr,
    from_name: r.from_name,
    to: r.to_addr,
    cc: r.cc_addr,
    subject: r.subject,
    date: r.date,
    received_at: r.received_at,
    text: r.text_body,
    html,
    has_attachments: !!r.has_attachments,
    attachments: atts.results ?? [],
  };
}

export async function getAttachment(env: Env, attachmentId: string) {
  const a = await env.DB.prepare(
    `SELECT id, email_id, filename, content_type, size, r2_key FROM attachments WHERE id = ?`
  ).bind(attachmentId).first<StoredAttachment>();
  if (!a) return null;
  const obj = await env.BUCKET.get(a.r2_key);
  if (!obj) return { meta: a, content_base64: null, error: "object missing in R2" };
  const buf = await obj.arrayBuffer();
  return {
    meta: { id: a.id, email_id: a.email_id, filename: a.filename, content_type: a.content_type, size: a.size },
    content_base64: arrayBufferToBase64(buf),
  };
}

export async function stats(env: Env) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            MAX(received_at) AS last_received_at,
            MAX(date) AS latest_date,
            SUM(has_attachments) AS with_attachments
       FROM emails`
  ).first<any>();
  return {
    total: r?.total ?? 0,
    with_attachments: r?.with_attachments ?? 0,
    last_received_at: r?.last_received_at ?? null,
    latest_date: r?.latest_date ?? null,
  };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
