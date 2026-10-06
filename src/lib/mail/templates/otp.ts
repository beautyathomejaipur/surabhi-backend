import type { MailContent } from '../client.js';
import { COLORS, escapeHtml, renderLayout } from './layout.js';

export const OTP_VALID_MINUTES = 10;

export function otpEmail(code: string, email: string): MailContent {
  const c = COLORS;

  const body = `
    <h1 style="margin:0 0 8px;font-size:21px;line-height:28px;color:${c.ink};font-weight:bold;">Your sign-in code</h1>
    <p style="margin:0 0 22px;font-size:15px;line-height:23px;color:${c.muted};">
      Use this code to sign in to Surabhi. It works for the next ${OTP_VALID_MINUTES} minutes, once.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="background-color:${c.cream};border:1px solid ${c.border};border-radius:10px;padding:20px 12px;">
          <div class="code" style="font-family:'Courier New',Courier,monospace;font-size:34px;line-height:40px;font-weight:bold;letter-spacing:10px;color:${c.goldDark};">${escapeHtml(code)}</div>
        </td>
      </tr>
    </table>
    <p style="margin:22px 0 0;font-size:13px;line-height:20px;color:${c.muted};">
      Surabhi will never call or message you asking for this code. If you didn't try to sign in,
      ignore this email &mdash; nothing happens unless the code is entered.
    </p>`;

  const text = [
    `Your Surabhi sign-in code: ${code}`,
    '',
    `It works for the next ${OTP_VALID_MINUTES} minutes, once.`,
    "Surabhi will never ask you for this code. If you didn't try to sign in, ignore this email.",
  ].join('\n');

  return {
    subject: `${code} is your Surabhi sign-in code`,
    html: renderLayout({
      preheader: `${code} — valid for ${OTP_VALID_MINUTES} minutes.`,
      body,
      footerNote: `Sent to ${escapeHtml(email)} because it was entered on the Surabhi sign-in page.`,
    }),
    text,
  };
}
