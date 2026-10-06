import { sendMail } from './client.js';
import { otpEmail } from './templates/otp.js';
import { welcomeEmail } from './templates/welcome.js';
import { vendorRequestAdminAlertEmail, vendorRequestReceivedEmail } from './templates/vendor-request.js';

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  await sendMail(email, otpEmail(code, email), 'otp');
}

export async function sendWelcomeEmail(email: string, name?: string | null): Promise<void> {
  await sendMail(email, welcomeEmail(email, name), 'welcome');
}

export async function sendVendorRequestEmails(req: Parameters<typeof vendorRequestReceivedEmail>[0]): Promise<void> {
  const jobs: Promise<void>[] = [sendMail(req.email, vendorRequestReceivedEmail(req), 'vendor_request_received')];
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (adminEmail) {
    jobs.push(sendMail(adminEmail, vendorRequestAdminAlertEmail(req, adminEmail), 'vendor_request_admin'));
  }
  await Promise.allSettled(jobs).then((results) => {
    for (const r of results) {
      if (r.status === 'rejected') console.error('[mail] vendor request email failed:', r.reason);
    }
  });
}
