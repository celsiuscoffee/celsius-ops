import { Resend } from "resend";

const FROM = process.env.RESEND_FROM_EMAIL || "Celsius Ops <no-reply@celsiuscoffee.com>";

let _client: Resend | null = null;
function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Resend(key);
  return _client;
}

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail({ to, subject, html, text }: SendEmailInput) {
  const client = getClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY missing — email not sent", { to, subject });
    return { ok: false as const, skipped: true as const };
  }
  const { data, error } = await client.emails.send({ from: FROM, to, subject, html, text });
  if (error) {
    console.error("[email] send failed", error);
    return { ok: false as const, error: error.message };
  }
  return { ok: true as const, id: data?.id };
}

export function passwordResetEmail({ name, resetUrl }: { name: string; resetUrl: string }) {
  const safeName = name || "there";
  const html = `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;background:#f6f6f6;padding:24px;color:#111">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <h2 style="margin:0 0 16px;font-size:18px">Reset your Celsius Ops password</h2>
    <p>Hi ${safeName},</p>
    <p>We received a request to reset your backoffice password. Click the button below to choose a new one. This link expires in 60 minutes.</p>
    <p style="margin:24px 0">
      <a href="${resetUrl}" style="background:#c2410c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Reset password</a>
    </p>
    <p style="font-size:12px;color:#666">If the button doesn't work, paste this link into your browser:<br/>
      <span style="word-break:break-all">${resetUrl}</span>
    </p>
    <p style="font-size:12px;color:#666;margin-top:24px">If you didn't request this, you can safely ignore this email — your password won't change.</p>
  </div>
</body></html>`;
  const text = `Reset your Celsius Ops password\n\nHi ${safeName},\n\nOpen this link within 60 minutes to choose a new password:\n${resetUrl}\n\nIf you didn't request this, ignore this email.`;
  return { html, text };
}
