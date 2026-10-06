import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { isValidEmail, normalizeEmail } from '../../lib/email-validation.js';
import { contactFormLimiter } from '../../lib/rate-limit.js';
import { requireAdminAuth } from '../admin-auth/admin-auth.middleware.js';

export const contactRouter = Router();

const MAX_MESSAGE_LENGTH = 4000;
const STATUSES = new Set(['NEW', 'IN_PROGRESS', 'RESOLVED']);

// GET /api/contact — admin inbox list.
// ?status= filters (NEW/IN_PROGRESS/RESOLVED), ?q= searches name/email/message,
// newest first so a fresh enquiry always surfaces at the top.
contactRouter.get('/', requireAdminAuth, async (req, res) => {
  const { status, q } = req.query;
  const inquiries = await prisma.contactInquiry.findMany({
    where: {
      ...(typeof status === 'string' && STATUSES.has(status) ? { status: status as never } : {}),
      ...(typeof q === 'string' && q.trim()
        ? {
            OR: [
              { name: { contains: q.trim(), mode: 'insensitive' } },
              { email: { contains: q.trim(), mode: 'insensitive' } },
              { message: { contains: q.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(inquiries);
});

// PATCH /api/contact/:id — admin marks an enquiry In Progress / Resolved / back to New.
contactRouter.patch('/:id', requireAdminAuth, async (req, res) => {
  const { status } = req.body ?? {};
  if (typeof status !== 'string' || !STATUSES.has(status)) {
    return res.status(400).json({ error: 'status must be NEW, IN_PROGRESS or RESOLVED.' });
  }
  const existing = await prisma.contactInquiry.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Inquiry not found' });

  const inquiry = await prisma.contactInquiry.update({
    where: { id: req.params.id },
    data: { status: status as never },
  });
  res.json(inquiry);
});

// POST /api/contact — public Contact Us form submission.
// Body: { name, email, phone?, subject?, message, website? }
// `website` is a honeypot field, same pattern as the OTP endpoint.
contactRouter.post('/', contactFormLimiter, async (req, res) => {
  const { name, email: rawEmail, phone, subject, message, website } = req.body ?? {};

  if (typeof website === 'string' && website.trim().length > 0) {
    return res.json({ success: true });
  }

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (typeof rawEmail !== 'string') {
    return res.status(400).json({ error: 'Email is required.' });
  }
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: 'Message is too long.' });
  }

  const email = normalizeEmail(rawEmail);
  const validation = isValidEmail(email);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.reason });
  }

  const inquiry = await prisma.contactInquiry.create({
    data: {
      name: name.trim(),
      email,
      phone: typeof phone === 'string' && phone.trim() ? phone.trim() : undefined,
      subject: typeof subject === 'string' && subject.trim() ? subject.trim() : undefined,
      message: message.trim(),
    },
  });

  res.status(201).json({ success: true, id: inquiry.id });
});

// POST /api/contact/callback — "Book on call" from the homepage. Only a name
// and an Indian mobile number; the request lands in the Contact Inquiries
// inbox (subject "Call-back request") so the support team can ring back.
contactRouter.post('/callback', contactFormLimiter, async (req, res) => {
  const { name, phone, trainOrStation, website } = req.body ?? {};

  if (typeof website === 'string' && website.trim().length > 0) {
    return res.status(201).json({ success: true });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }
  let digits = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
  }

  const journey = typeof trainOrStation === 'string' ? trainOrStation.trim().slice(0, 120) : '';
  const inquiry = await prisma.contactInquiry.create({
    data: {
      name: name.trim().slice(0, 80),
      phone: digits,
      subject: 'Call-back request',
      message: journey
        ? `Wants to order food on call. Journey: ${journey}`
        : 'Wants to order food on call. Please call back.',
    },
  });

  res.status(201).json({ success: true, id: inquiry.id });
});
