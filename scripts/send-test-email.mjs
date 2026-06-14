// 发一封测试邮件，验证「收信 → 入库」是否打通。
// 用法: node scripts/send-test-email.mjs test@你的域名
// 它会直接连你域名的邮件服务器(MX)投递一封带中文和附件的样例邮件。
import { resolveMx } from "node:dns/promises";
import net from "node:net";

const to = process.argv[2] || process.env.TO;
if (!to || !to.includes("@")) {
  console.error("用法: node scripts/send-test-email.mjs test@你的域名");
  process.exit(1);
}
const domain = to.split("@")[1];
const from = `selftest@${domain}`; // 用同域名发件，便于通过 SPF 检查

// 读取一条完整 SMTP 应答（处理多行 250- ... 250 ...）
function readReply(sock) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      if (/^\d{3} /.test(last)) {
        sock.removeListener("data", onData);
        resolve({ code: parseInt(last.slice(0, 3), 10), text: buf.trim() });
      }
    };
    sock.on("data", onData);
    sock.once("error", reject);
  });
}

function send(sock, line) {
  sock.write(line + "\r\n");
  return readReply(sock);
}

function buildMessage() {
  const b = "BOUND_MIXED_PART";
  const subj = Buffer.from("测试邮件 发票 E2E", "utf8").toString("base64");
  const pdf = Buffer.from("%PDF-1.4 sample invoice bytes").toString("base64");
  return [
    `From: 自测 <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${subj}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${b}"`,
    "",
    `--${b}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    "你好，这是一封测试邮件，发票金额 8888 元。Hello from the test script.",
    `--${b}`,
    'Content-Type: application/pdf; name="invoice.pdf"',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    pdf,
    `--${b}--`,
    "",
  ].join("\r\n");
}

const mx = (await resolveMx(domain)).sort((a, b) => a.priority - b.priority)[0]?.exchange;
if (!mx) {
  console.error(`找不到 ${domain} 的邮件服务器(MX)，确认域名已开启 Email Routing。`);
  process.exit(1);
}
console.log(`连接 ${mx}:25，发往 ${to} ...`);

const sock = net.createConnection({ host: mx, port: 25 });
sock.setEncoding("utf8");
try {
  await readReply(sock); // 220 greeting
  await send(sock, `EHLO ${domain}`);
  console.log("MAIL FROM:", (await send(sock, `MAIL FROM:<${from}>`)).code);
  console.log("RCPT TO:", (await send(sock, `RCPT TO:<${to}>`)).code);
  const data = await send(sock, "DATA");
  if (data.code !== 354) throw new Error("DATA 被拒: " + data.text);
  sock.write(buildMessage() + "\r\n.\r\n");
  const done = await readReply(sock);
  console.log("投递结果:", done.code, done.text);
  await send(sock, "QUIT");
  sock.end();
  console.log(done.code === 250 ? "✅ 已投递，几秒后让 AI 或 stats 查一下应该就能看到。" : "⚠️ 投递未被接受，看上面的返回信息。");
} catch (e) {
  console.error("发送失败:", e.message);
  sock.end();
  process.exit(1);
}
