import type { MailContent } from '../client.js';
import { COLORS, escapeHtml, renderButton, renderLayout } from './layout.js';

const APP_URL = (process.env.APP_URL || 'https://surabhicatering.com').replace(/\/$/, '');

type RequestSummary = {
  restaurantName: string;
  ownerName: string;
  phone: string;
  email: string;
  city: string;
  stationName: string;
};

// Sent to the applicant right after they submit the Partner form, so they
// know the request landed and what happens next.
export function vendorRequestReceivedEmail(req: RequestSummary): MailContent {
  const c = COLORS;
  const firstName = req.ownerName.trim().split(/\s+/)[0];

  const body = `
    <h1 style="margin:0 0 8px;font-size:21px;line-height:28px;color:${c.ink};font-weight:bold;">We've got your application</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:23px;color:${c.muted};">
      Hi ${escapeHtml(firstName)}, thanks for applying to list <strong style="color:${c.ink};">${escapeHtml(req.restaurantName)}</strong>
      at ${escapeHtml(req.stationName)} on Surabhi.
    </p>
    <p style="margin:0 0 18px;font-size:14px;line-height:22px;color:${c.muted};">
      Someone from our partner team will call you on <strong style="color:${c.ink};">${escapeHtml(req.phone)}</strong>
      within 2 working days. Please keep your FSSAI licence and a few photos of your kitchen handy &mdash;
      that is all we need to get you started.
    </p>
    ${renderButton('See how partnering works', `${APP_URL}/partner`)}
    <p style="margin:26px 0 0;font-size:13px;line-height:20px;color:${c.muted};">
      Have a question before we call? Just reply to this email.
    </p>`;

  const text = [
    "We've got your application",
    '',
    `Hi ${firstName}, thanks for applying to list ${req.restaurantName} at ${req.stationName} on Surabhi.`,
    '',
    `Our partner team will call you on ${req.phone} within 2 working days.`,
    'Please keep your FSSAI licence and a few kitchen photos handy.',
    '',
    `More details: ${APP_URL}/partner`,
    'Questions? Reply to this email.',
  ].join('\n');

  return {
    subject: `Application received — ${req.restaurantName}`,
    html: renderLayout({
      preheader: 'Our partner team will call you within 2 working days.',
      body,
      footerNote: `Sent to ${escapeHtml(req.email)} because a partner application was submitted with this address.`,
    }),
    text,
  };
}

// Heads-up to the Super Admin inbox so a new request doesn't sit unseen
// until someone happens to open the panel.
export function vendorRequestAdminAlertEmail(req: RequestSummary, adminEmail: string): MailContent {
  const c = COLORS;
  const rows: [string, string][] = [
    ['Restaurant', req.restaurantName],
    ['Owner', req.ownerName],
    ['Phone', req.phone],
    ['Email', req.email],
    ['City', req.city],
    ['Station', req.stationName],
  ];

  const table = rows
    .map(
      ([k, v]) => `
      <tr>
        <td style="padding:6px 12px 6px 0;font-size:13px;color:${c.muted};white-space:nowrap;">${k}</td>
        <td style="padding:6px 0;font-size:13px;color:${c.ink};font-weight:bold;">${escapeHtml(v)}</td>
      </tr>`,
    )
    .join('');

  const body = `
    <h1 style="margin:0 0 14px;font-size:20px;line-height:27px;color:${c.ink};font-weight:bold;">New vendor request</h1>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">${table}</table>
    ${renderButton('Review in admin panel', `${APP_URL}/admin/vendor-requests`)}`;

  return {
    subject: `New vendor request: ${req.restaurantName} (${req.stationName})`,
    html: renderLayout({
      preheader: `${req.restaurantName} at ${req.stationName} wants to join.`,
      body,
      footerNote: `Sent to ${escapeHtml(adminEmail)} as the Super Admin inbox.`,
    }),
    text: [
      'New vendor request',
      '',
      ...rows.map(([k, v]) => `${k}: ${v}`),
      '',
      `Review: ${APP_URL}/admin/vendor-requests`,
    ].join('\n'),
  };
}
