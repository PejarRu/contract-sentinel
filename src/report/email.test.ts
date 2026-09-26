// SMTP unit tests: URL parsing, MIME building/header injection, mock SMTP
// conversation, security refusals, disabled-by-default behavior. Offline
// (mock server on 127.0.0.1 only).

import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  parseSmtpUrl,
  buildMime,
  sendEmail,
  sendDigestEmail,
  emailEnabled,
  buildDigestSubject,
  type SmtpConfig,
} from "./email.js";

function cfg(over: Partial<SmtpConfig> = {}): SmtpConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    secure: false,
    allowPlainText: false,
    from: "sentinel@test.local",
    to: "user@test.local",
    ...over,
  };
}

test("email is disabled unless EMAIL_ENABLED=true", async () => {
  const prev = process.env.EMAIL_ENABLED;
  delete process.env.EMAIL_ENABLED;
  try {
    assert.equal(emailEnabled(), false);
    const r = await sendDigestEmail({ subject: "x", html: "<p>x</p>", text: "x" });
    assert.equal(r.sent, false);
    assert.match(r.error ?? "", /EMAIL_ENABLED/);
  } finally {
    if (prev !== undefined) process.env.EMAIL_ENABLED = prev;
  }
});

test("digest subject shows verdict counts", () => {
  assert.equal(buildDigestSubject(12, 140, 3, 2), "[contract-sentinel] Digesto 12h — 140 contratos, HIGH x3");
  assert.equal(buildDigestSubject(12, 5, 0, 2), "[contract-sentinel] Digesto 12h — 5 contratos, MED x2");
  assert.equal(buildDigestSubject(12, 0, 0, 0), "[contract-sentinel] Digesto 12h — 0 contratos, sin hallazgos");
});

test("SMTP_URL parsing (credentials URL-encoded)", () => {
  const c = parseSmtpUrl("smtp://user%40gmail.com:p%40ss@smtp.gmail.com:587");
  assert.equal(c.host, "smtp.gmail.com");
  assert.equal(c.port, 587);
  assert.equal(c.user, "user@gmail.com");
  assert.equal(c.password, "p@ss");
  assert.equal(c.secure, false);
  const s = parseSmtpUrl("smtps://u:p@smtp.gmail.com");
  assert.equal(s.secure, true);
  assert.equal(s.port, 465);
  assert.throws(() => parseSmtpUrl("http://x/y"), /scheme/);
});

test("MIME message has text+html parts and sanitized headers", () => {
  const mime = buildMime({
    from: "sentinel@test.local",
    to: "a@b.c",
    subject: "Injected\r\nBcc: evil@x.y",
    html: "<p>hi</p>",
    text: "hi",
  });
  assert.ok(mime.includes("Subject: Injected Bcc: evil@x.y"), "header injection neutralized");
  assert.ok(!/\r\nBcc: evil@x\.y/.test(mime), "no injected Bcc header line");
  assert.ok(mime.includes("Content-Type: text/plain"));
  assert.ok(mime.includes("Content-Type: text/html"));
  assert.ok(mime.includes("<p>hi</p>"));
});

/** Minimal SMTP mock. opts.starttls advertises STARTTLS (no TLS support!). */
function mockServer(received: string[], opts: { starttls?: boolean; auth?: boolean } = {}): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.write("220 mock ESMTP\r\n");
      let inData = false;
      let dataBuffer = "";
      sock.on("data", (chunk) => {
        const s = chunk.toString();
        if (inData) {
          dataBuffer += s;
          if (dataBuffer.includes("\r\n.\r\n")) {
            inData = false;
            received.push(dataBuffer);
            dataBuffer = "";
            sock.write("250 queued\r\n");
          }
          return;
        }
        const lines = s.split("\r\n").filter(Boolean);
        for (const line of lines) {
          if (line.startsWith("EHLO") || line.startsWith("HELO")) {
            const caps = ["250-mock"];
            if (opts.starttls) caps.push("250-STARTTLS");
            if (opts.auth) caps.push("250-AUTH PLAIN LOGIN");
            caps.push("250 SIZE 10485760");
            sock.write(caps.join("\r\n") + "\r\n");
          } else if (line.startsWith("STARTTLS")) {
            sock.write("454 TLS not available\r\n");
          } else if (line.startsWith("AUTH PLAIN")) {
            sock.write("235 accepted\r\n");
          } else if (line.startsWith("MAIL") || line.startsWith("RCPT")) {
            sock.write("250 OK\r\n");
          } else if (line.startsWith("DATA")) {
            inData = true;
            dataBuffer = "";
            sock.write("354 go\r\n");
          } else if (line.startsWith("QUIT")) {
            sock.write("221 bye\r\n");
            sock.end();
          }
        }
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("SMTP conversation completes against a mock server (dot-stuffing)", async () => {
  const received: string[] = [];
  const server = await mockServer(received);
  const port = (server.address() as net.AddressInfo).port;
  const r = await sendEmail(
    {
      from: "sentinel@test.local",
      to: "user@test.local",
      subject: "sentinel test",
      html: "<p>line</p>",
      text: ".leading dot\nsecond",
    },
    cfg({ port }),
  );
  assert.equal(r.sent, true, r.error);
  assert.equal(received.length, 1);
  assert.ok(received[0].includes("..leading dot"), "leading dot must be stuffed");
  assert.ok(received[0].includes("Subject: sentinel test"));
  server.close();
});

test("client refuses to send credentials without STARTTLS", async () => {
  const received: string[] = [];
  const server = await mockServer(received, { auth: false });
  const port = (server.address() as net.AddressInfo).port;
  const r = await sendEmail(
    { from: "a@b.c", to: "d@e.f", subject: "x", html: "<p>x</p>", text: "x" },
    cfg({ port, user: "u", password: "p", allowPlainText: false }),
  );
  assert.equal(r.sent, false);
  assert.match(r.error ?? "", /STARTTLS/);
  assert.equal(received.length, 0, "nothing sent");
  server.close();
});

test("allowPlainText=true permits auth on plaintext (explicit opt-in)", async () => {
  const received: string[] = [];
  const server = await mockServer(received, { auth: true });
  const port = (server.address() as net.AddressInfo).port;
  const r = await sendEmail(
    { from: "a@b.c", to: "d@e.f", subject: "x", html: "<p>x</p>", text: "x" },
    cfg({ port, user: "u", password: "p", allowPlainText: true }),
  );
  assert.equal(r.sent, true, r.error);
  assert.equal(received.length, 1);
  server.close();
});

test("connection refused reports failure instead of throwing", async () => {
  const r = await sendEmail(
    { from: "a@b.c", to: "d@e.f", subject: "x", html: "<p>x</p>", text: "x" },
    cfg({ port: 1 }),
  );
  assert.equal(r.sent, false);
  assert.ok(r.error !== undefined);
});

test("AUTH failure error contains no user/password/base64", async () => {
  const server = await new Promise<net.Server>((resolve) => {
    const s = net.createServer((sock) => {
      sock.write("220 mock ESMTP\r\n");
      sock.on("data", (chunk) => {
        for (const line of chunk.toString().split("\r\n").filter(Boolean)) {
          if (line.startsWith("EHLO")) {
            sock.write("250-mock\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 10485760\r\n");
          } else if (line.startsWith("AUTH PLAIN")) {
            sock.write("535 authentication credentials rejected\r\n");
          } else if (line.startsWith("QUIT")) {
            sock.write("221 bye\r\n");
            sock.end();
          }
        }
      });
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as net.AddressInfo).port;
  const user = "secretuser@example.com";
  const password = "supersecretpassword";
  const r = await sendEmail(
    { from: "w@t.local", to: "a@b.c", subject: "x", html: "<p>x</p>", text: "x" },
    cfg({ port, user, password, allowPlainText: true }),
  );
  assert.equal(r.sent, false);
  assert.match(r.error ?? "", /AUTH PLAIN \[redacted\]/, "safe redacted label in error");
  const b64 = Buffer.from(`\0${user}\0${password}`).toString("base64");
  assert.ok(!(r.error ?? "").includes(user), "no username in error");
  assert.ok(!(r.error ?? "").includes(password), "no password in error");
  assert.ok(!(r.error ?? "").includes(b64), "no credential base64 in error");
  server.close();
});
