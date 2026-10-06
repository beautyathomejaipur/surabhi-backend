import { Resend } from 'resend';

export type MailContent = {
  subject: string;
  html: string;
  text: string;
};

const apiKey = process.env.RESEND_API_KEY;
const resend = apiKey ? new Resend(apiKey) : null;

// The sender must be on a domain verified in Resend (e.g. "Surabhi <hello@yourdomain.com>").
// Until a domain is verified, Resend only allows "onboarding@resend.dev" and only delivers to
// the account owner's own inbox — fine for a first smoke test, useless for real customers.
const FROM = process.env.MAIL_FROM || 'Surabhi <onboarding@resend.dev>';
const REPLY_TO = process.env.MAIL_REPLY_TO || undefined;

export async function sendMail(to: string, content: MailContent, tag: string): Promise<void> {
  if (!resend) {
    throw new Error('RESEND_API_KEY is not set — cannot send email.');
  }

  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    replyTo: REPLY_TO,
    subject: content.subject,
    html: content.html,
    text: content.text,
    tags: [{ name: 'type', value: tag }],
  });

  if (error) {
    // Local testing without a verified domain: Resend refuses every recipient except the account
    // owner. With MAIL_DEV_FALLBACK=true the message is printed to this terminal instead, so the
    // sign-in flow can still be exercised. Never enable this in production.
    if (process.env.MAIL_DEV_FALLBACK === 'true' && process.env.NODE_ENV !== 'production') {
      console.warn(`[mail:dev-fallback] Resend refused (${error.message})`);
      console.warn(`[mail:dev-fallback] ${tag} -> ${to}\n${content.text}\n`);
      return;
    }

    // Resend reports failures as a value, not an exception — surface it as one so callers
    // can decide between "tell the user" (OTP) and "log and move on" (welcome).
    throw new Error(`Resend rejected the ${tag} email: ${error.name} — ${error.message}`);
  }

  console.log(`[mail] ${tag} -> ${to} id=${data?.id}`);
}
