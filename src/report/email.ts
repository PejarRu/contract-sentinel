// Email delivery for digests.
//
// Design constraints (same style as morpho-liquidation/src/report/email.ts):
//   - Disabled unless EMAIL_ENABLED=true (prevents accidental sends).
//   - Config from SMTP_URL ("smtp://user:pass@host:port" or "smtps://...")
//     OR discrete SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_TLS.
//   - Minimal built-in SMTP client (node:net/node:tls) — no extra dependency.
//   - Failures reported as SendResult, never thrown.
//   - Secrets (password) never logged.

import net from "node:net";
import tls from "node:tls";

/** Subject for the 12h digest: verdict counts visible before opening. */
export function buildDigestSubject(windowH: number, contracts: number, high: number, medium: number): string {
  const flag = high > 0 ? `HIGH x${high}` : medium > 0 ? `MED x${medium}` : "sin hallazgos";
  return `[contract-sentinel] Digesto ${windowH}h — ${contracts} contratos, ${flag}`;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean; // implicit TLS
  user?: string;
  password?: string;
  allowPlainText: boolean; // allow auth without STARTTLS (never default)
  from: string;
  to: string;
  /** Overall per-message socket timeout, ms (default 20000). */
  timeoutMs?: number;
}

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  sent: boolean;
  error?: string;
}

export function emailEnabled(): boolean {
  return process.env.EMAIL_ENABLED === "true";
}

/** Parse smtp://user:pass@host:port or smtps://... (URL-encoding respected). */
export function parseSmtpUrl(raw: string): Partial<SmtpConfig> {
  const u = new URL(raw);
  if (u.protocol !== "smtp:" && u.protocol !== "smtps:") {
    throw new Error(`SMTP_URL scheme must be smtp: or smtps:, got ${u.protocol}`);
  }
  const secure = u.protocol === "smtps:" || u.port === "465";
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : secure ? 465 : 25,
    secure,
    user: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
  };
}

/**
 * Build config from env. Throws on malformed SMTP_URL (callers catch).
 * Returns undefined when no host is configured.
 */
export function loadSmtpConfig(): SmtpConfig | undefined {
  let cfg: Partial<SmtpConfig> = {};
  const url = process.env.SMTP_URL;
  if (url) cfg = parseSmtpUrl(url);
  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    cfg.host = process.env.SMTP_HOST;
    cfg.port = port;
    cfg.secure =
      (process.env.SMTP_TLS ?? "").toLowerCase() === "implicit" || port === 465;
    cfg.user = process.env.SMTP_USER || undefined;
    cfg.password = process.env.SMTP_PASSWORD || undefined;
  }
  if (!cfg.host) return undefined;
  return {
    host: cfg.host,
    port: cfg.port ?? (cfg.secure ? 465 : 587),
    secure: cfg.secure ?? false,
    user: cfg.user,
    password: cfg.password,
    allowPlainText: (process.env.SMTP_ALLOW_PLAIN ?? "").toLowerCase() === "true",
    from: process.env.EMAIL_FROM ?? process.env.EMAIL_TO ?? "contract-sentinel@localhost",
    to: process.env.EMAIL_TO ?? "",
  };
}

// ---------------------------------------------------------------------------
// Minimal SMTP client
// ---------------------------------------------------------------------------

class SmtpSession {
  private buffer = "";
  private waiter:
    | { resolve: (lines: string[]) => void; reject: (e: Error) => void }
    | null = null;

  constructor(readonly socket: net.Socket | tls.TLSSocket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.tryFlush();
    });
    socket.on("error", (e: Error) => this.waiter?.reject(e));
    socket.on("close", () => this.waiter?.reject(new Error("connection closed")));
  }

  private tryFlush(): void {
    if (!this.waiter) return;
    const lines = this.buffer.split(/\r?\n/);
    const last = lines[lines.length - 2]; // trailing "" after final CRLF
    if (last !== undefined && /^\d{3} /.test(last)) {
      const done = lines.slice(0, lines.length - 1);
      this.buffer = "";
      const w = this.waiter;
      this.waiter = null;
      w.resolve(done);
    }
  }

  read(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
      this.tryFlush();
    });
  }

  write(line: string): void {
    this.socket.write(line + "\r\n");
  }

  async command(cmd: string, expect: number[], label?: string): Promise<string[]> {
    this.write(cmd);
    const lines = await this.read();
    const code = Number(lines[lines.length - 1]?.slice(0, 3));
    if (!expect.includes(code)) {
      // AUTH errors must be REDACTED — the raw command contains base64 credentials.
      throw new Error(
        `smtp: unexpected reply to ${label ?? cmd.split(" ")[0]}: ${lines.join(" / ").slice(0, 200)}`,
      );
    }
    return lines;
  }
}

function smtpEscapeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

export function buildMime(msg: EmailMessage): string {
  const boundary = `sentinel-${Date.now().toString(36)}`;
  const lines: string[] = [
    `From: ${smtpEscapeHeader(msg.from)}`,
    `To: ${smtpEscapeHeader(msg.to)}`,
    `Subject: ${smtpEscapeHeader(msg.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  for (const [k, v] of Object.entries(msg.headers ?? {})) {
    lines.push(`${k}: ${smtpEscapeHeader(v)}`);
  }
  lines.push("", `--${boundary}`);
  lines.push(
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
  );
  lines.push(msg.text);
  lines.push(`--${boundary}`);
  lines.push(
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
  );
  lines.push(msg.html);
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

/** Send an email over SMTP. Resolves with a result; never throws. */
export async function sendEmail(
  msg: EmailMessage,
  cfgOverride?: SmtpConfig,
  signal?: AbortSignal,
): Promise<SendResult> {
  const cfg = cfgOverride;
  if (!cfg) return { sent: false, error: "no smtp config" };
  if (signal?.aborted) return { sent: false, error: "aborted before connect" };
  return new Promise<SendResult>((resolve) => {
    let socket: net.Socket | tls.TLSSocket;
    try {
      socket = cfg.secure
        ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
        : net.connect({ host: cfg.host, port: cfg.port });
    } catch (e) {
      resolve({ sent: false, error: `connect failed: ${String(e)}` });
      return;
    }
    socket.setTimeout(cfg.timeoutMs ?? 20_000, () => {
      socket.destroy();
      resolve({ sent: false, error: "smtp timeout" });
    });

    let settled = false;
    const onAbort = (): void => {
      socket.destroy();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (r: SendResult): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    socket.once("error", (e: Error) => finish({ sent: false, error: e.message }));
    socket.once("close", () => finish({ sent: false, error: "connection closed" }));

    const run = async (): Promise<void> => {
      let session = new SmtpSession(socket);
      const greeting = await session.read();
      if (!greeting.length || !greeting[greeting.length - 1].startsWith("220")) {
        throw new Error(`bad greeting: ${greeting.join(" / ")}`);
      }
      const ehloName = "contract-sentinel.local";
      let caps = await session.command(`EHLO ${ehloName}`, [250]);
      if (!cfg.secure) {
        const hasStartTls = caps.some((l) => /STARTTLS/i.test(l));
        if (hasStartTls) {
          await session.command("STARTTLS", [220]);
          const upgraded = await new Promise<tls.TLSSocket>((res, rej) => {
            const t = tls.connect({ socket, servername: cfg.host }, () => res(t));
            t.once("error", rej);
          });
          session.socket.removeAllListeners("data");
          session.socket.removeAllListeners("error");
          session.socket.removeAllListeners("close");
          session = new SmtpSession(upgraded);
          caps = await session.command(`EHLO ${ehloName}`, [250]);
        } else if (!cfg.allowPlainText && (cfg.user || cfg.password)) {
          throw new Error(
            "server does not offer STARTTLS; refusing to send credentials in plaintext",
          );
        }
      }
      await conversation(session, caps, cfg, msg, finish);
    };
    run().catch((e: Error) => finish({ sent: false, error: e.message }));
  });
}

async function conversation(
  session: SmtpSession,
  caps: string[],
  cfg: SmtpConfig,
  msg: EmailMessage,
  finish: (r: SendResult) => void,
): Promise<void> {
  if (cfg.user && cfg.password) {
    const authLine = caps.find((l) => /^250[- ]AUTH/i.test(l) || /^250[- ].* AUTH/i.test(l));
    if (authLine) {
      if (/PLAIN/i.test(authLine)) {
        // Inline base64 contains \0user\0password — never log it.
        const b64 = Buffer.from(`\0${cfg.user}\0${cfg.password}`).toString("base64");
        await session.command(`AUTH PLAIN ${b64}`, [235], "AUTH PLAIN [redacted]");
      } else if (/LOGIN/i.test(authLine)) {
        await session.command("AUTH LOGIN", [334], "AUTH LOGIN [redacted]");
        await session.command(
          Buffer.from(cfg.user).toString("base64"),
          [334],
          "AUTH LOGIN username [redacted]",
        );
        await session.command(
          Buffer.from(cfg.password).toString("base64"),
          [235],
          "AUTH LOGIN password [redacted]",
        );
      }
    }
  }
  await session.command(`MAIL FROM:<${cfg.from}>`, [250]);
  for (const rcpt of msg.to.split(",").map((s) => s.trim()).filter(Boolean)) {
    await session.command(`RCPT TO:<${rcpt}>`, [250, 251]);
  }
  await session.command("DATA", [354]);
  const mime = buildMime(msg)
    .split("\r\n")
    .map((l) => (l.startsWith(".") ? "." + l : l))
    .join("\r\n");
  session.write(mime);
  session.write(".");
  const dataReply = await session.read();
  const dataCode = Number(dataReply[dataReply.length - 1]?.slice(0, 3));
  if (dataCode !== 250) {
    finish({ sent: false, error: `DATA rejected: ${dataReply.join(" / ").slice(0, 200)}` });
    return;
  }
  session.write("QUIT");
  finish({ sent: true });
}

/**
 * High-level send. Respects EMAIL_ENABLED.
 * Never throws; SMTP_URL parse errors surface as { sent: false }.
 */
export async function sendDigestEmail(
  msg: {
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
  },
  signal?: AbortSignal,
): Promise<SendResult> {
  if (!emailEnabled()) {
    return { sent: false, error: "EMAIL_ENABLED is not true — email disabled" };
  }
  let cfg: SmtpConfig | undefined;
  try {
    cfg = loadSmtpConfig();
  } catch {
    // URL parse errors can echo credentials — report a static redacted message.
    return { sent: false, error: "invalid SMTP configuration (SMTP_URL)" };
  }
  if (!cfg) {
    return { sent: false, error: "no SMTP configuration (SMTP_URL or SMTP_HOST)" };
  }
  if (!cfg.to) {
    return { sent: false, error: "EMAIL_TO is empty" };
  }
  return sendEmail({ ...msg, from: cfg.from, to: cfg.to }, cfg, signal);
}
