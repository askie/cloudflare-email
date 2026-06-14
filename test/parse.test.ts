import { test, expect } from "vitest";
import { parseRaw } from "../src/parse";

const RAW = [
  "From: Alice <alice@example.com>",
  "To: inbox@example.com",
  "Cc: ops@example.com",
  "Subject: Test Invoice 2026",
  "Message-ID: <test-123@example.com>",
  "Date: Sat, 14 Jun 2026 06:00:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="BOUND"',
  "",
  "--BOUND",
  "Content-Type: text/plain; charset=UTF-8",
  "",
  "你好，这是一封测试邮件，包含发票信息。Hello world.",
  "--BOUND",
  'Content-Type: text/plain; name="note.txt"',
  'Content-Disposition: attachment; filename="note.txt"',
  "",
  "attachment body content",
  "--BOUND--",
  "",
].join("\r\n");

test("parseRaw extracts headers, Chinese body, and attachment", async () => {
  const parsed = await parseRaw(RAW);

  expect(parsed.from_addr).toBe("alice@example.com");
  expect(parsed.from_name).toBe("Alice");
  expect(parsed.to_addr).toContain("inbox@example.com");
  expect(parsed.cc_addr).toContain("ops@example.com");
  expect(parsed.subject).toBe("Test Invoice 2026");
  expect(parsed.msg_id).toContain("test-123@example.com");
  expect(parsed.date).toBe(Date.parse("Sat, 14 Jun 2026 06:00:00 +0000"));
  expect(parsed.text_body).toContain("测试邮件");

  expect(parsed.attachments).toHaveLength(1);
  expect(parsed.attachments[0].filename).toBe("note.txt");
  expect(parsed.attachments[0].content.byteLength).toBeGreaterThan(0);
});
