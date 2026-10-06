// Shared email shell. Tables + inline styles because Gmail, Outlook and most mobile clients
// strip modern CSS layout; the <style> block only holds a mobile media query, which is safe
// to lose in clients that ignore it.

export const COLORS = {
  gold: '#c9a227',
  goldDark: '#9c7c17',
  rose: '#c97b7b',
  roseDark: '#a85e5e',
  cream: '#fdfaf3',
  ink: '#2b2622',
  muted: '#7a7068',
  faint: '#9a9089',
  page: '#f1eee8',
  border: '#ece5d8',
} as const;

const FONT = "Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderLayout(opts: { preheader: string; body: string; footerNote: string }): string {
  const c = COLORS;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>Surabhi</title>
<style>
  body { margin:0; padding:0; width:100% !important; }
  a { color:${c.goldDark}; }
  @media only screen and (max-width:620px) {
    .pad { padding-left:22px !important; padding-right:22px !important; }
    .code { font-size:28px !important; letter-spacing:7px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${c.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${c.page};">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${c.page};">
  <tr>
    <td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid ${c.border};border-radius:14px;overflow:hidden;">
        <tr>
          <td class="pad" align="left" style="padding:24px 34px 20px;border-bottom:1px solid ${c.border};font-family:${FONT};">
            <span style="font-size:18px;font-weight:bold;letter-spacing:2.5px;color:${c.goldDark};">SURABHI</span>
            <span style="font-size:9px;font-weight:bold;letter-spacing:2.5px;color:${c.rose};text-transform:uppercase;padding-left:8px;">Hotels &amp; Catering</span>
          </td>
        </tr>
        <tr>
          <td class="pad" style="padding:30px 34px 30px;font-family:${FONT};">
            ${opts.body}
          </td>
        </tr>
        <tr>
          <td class="pad" style="background-color:${c.cream};padding:18px 34px;border-top:1px solid ${c.border};font-family:${FONT};">
            <p style="margin:0 0 4px;font-size:12px;line-height:19px;color:${c.muted};">${opts.footerNote}</p>
            <p style="margin:0;font-size:11px;line-height:18px;color:${c.faint};">Surabhi Hotels &amp; Catering &middot; Food from FSSAI-certified kitchens, delivered to your train seat.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function renderButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="background-color:${COLORS.roseDark};border-radius:8px;">
        <a href="${href}" style="display:inline-block;padding:12px 26px;font-family:${FONT};font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

export const FONT_STACK = FONT;
