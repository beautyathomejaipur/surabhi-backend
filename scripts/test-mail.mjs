// Sends one real OTP email and one welcome email through Resend.
// Usage: pnpm exec tsx scripts/test-mail.mjs someone@example.com
import 'dotenv/config';
import { pathToFileURL, fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const to = process.argv[2];

if (!to) {
  console.error('Pass a recipient: pnpm exec tsx scripts/test-mail.mjs you@example.com');
  process.exit(1);
}

console.log('API key :', process.env.RESEND_API_KEY ? 'set' : 'MISSING');
console.log('From    :', process.env.MAIL_FROM || 'Surabhi <onboarding@resend.dev> (default)');
console.log('To      :', to, '\n');

const { sendOtpEmail, sendWelcomeEmail } = await import(
  pathToFileURL(join(root, 'src', 'lib', 'mail', 'index.ts')).href
);

try {
  await sendOtpEmail(to, '482913');
  await sendWelcomeEmail(to, 'Shrikant Soni');
  console.log('\nDone. Check the inbox (and spam).');
} catch (err) {
  console.error('\nSEND FAILED:', err.message);
}
process.exit(0);
