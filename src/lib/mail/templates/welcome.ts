import type { MailContent } from '../client.js';
import { COLORS, escapeHtml, FONT_STACK, renderButton, renderLayout } from './layout.js';

const APP_URL = (process.env.APP_URL || 'https://surabhicatering.com').replace(/\/$/, '');

const STEPS = [
  { title: 'Enter your PNR', text: 'We work out which stations your train stops at next.' },
  { title: 'Pick a kitchen', text: 'Every restaurant listed is FSSAI-verified.' },
  { title: 'Eat at your seat', text: 'The order is handed over when the train pulls in.' },
];

export function welcomeEmail(email: string, name?: string | null): MailContent {
  const c = COLORS;
  const firstName = name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';

  const steps = STEPS.map(
    (s, i) => `
      <tr>
        <td width="30" valign="top" style="padding:0 12px 14px 0;">
          <div style="width:24px;height:24px;line-height:24px;text-align:center;border-radius:12px;background-color:${c.gold};font-family:${FONT_STACK};font-size:12px;font-weight:bold;color:#ffffff;">${i + 1}</div>
        </td>
        <td valign="top" style="padding:0 0 14px;font-family:${FONT_STACK};">
          <div style="font-size:14px;font-weight:bold;color:${c.ink};">${s.title}</div>
          <div style="font-size:13px;line-height:19px;color:${c.muted};padding-top:2px;">${s.text}</div>
        </td>
      </tr>`,
  ).join('');

  const body = `
    <h1 style="margin:0 0 8px;font-size:21px;line-height:28px;color:${c.ink};font-weight:bold;">You're in. Welcome to Surabhi.</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:23px;color:${c.muted};">
      ${greeting} you can now order hot food to your train seat from kitchens at the stations on your route.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">${steps}</table>
    ${renderButton('Find food on your train', APP_URL)}
    <p style="margin:26px 0 0;font-size:13px;line-height:20px;color:${c.muted};">
      Need help with an order? Reply to this email &mdash; it goes to a person on our team.
    </p>`;

  const text = [
    "Welcome to Surabhi — you're in.",
    '',
    `${firstName ? `Hi ${firstName},` : 'Hi,'} you can now order hot food to your train seat.`,
    '',
    '1. Enter your PNR — we find the stations on your route.',
    '2. Pick a kitchen — every restaurant is FSSAI-verified.',
    '3. Eat at your seat — handed over when the train pulls in.',
    '',
    `Start here: ${APP_URL}`,
    'Need help? Reply to this email.',
  ].join('\n');

  return {
    subject: "Welcome to Surabhi",
    html: renderLayout({
      preheader: 'Your account is ready. Here is how ordering on your train works.',
      body,
      footerNote: `Sent to ${escapeHtml(email)} because an account was just created with it.`,
    }),
    text,
  };
}
