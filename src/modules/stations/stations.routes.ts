import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { prisma } from '../../lib/prisma.js';
import { withStatus } from '../../lib/outlet-status.js';
import { requireAdminAuth } from '../admin-auth/admin-auth.middleware.js';

export const stationsRouter = Router();

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }, // 2MB is generous for a station list
});

// GET /api/stations — list junctions.
// ?q= filters by name/code (case-insensitive contains) — powers the homepage station search.
// ?active=true restricts to active-only.
stationsRouter.get('/', async (req, res) => {
  const { q, active, withOutlets } = req.query;

  // ?withOutlets=true — only stations a customer can actually order at
  // (at least one approved, live outlet), busiest first. Powers the
  // homepage's "popular stations" chips.
  if (withOutlets === 'true') {
    const liveOutlet = { isActive: true, status: 'APPROVED' as const };
    const stations = await prisma.station.findMany({
      where: { isActive: true, outlets: { some: liveOutlet } },
      select: {
        id: true,
        code: true,
        name: true,
        state: true,
        _count: { select: { outlets: { where: liveOutlet } } },
      },
      orderBy: { outlets: { _count: 'desc' } },
      take: 24,
    });
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(stations);
  }

  const stations = await prisma.station.findMany({
    where: {
      ...(active === 'true' ? { isActive: true } : {}),
      ...(typeof q === 'string' && q.trim()
        ? {
            OR: [
              { name: { contains: q.trim(), mode: 'insensitive' } },
              { code: { contains: q.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: { _count: { select: { outlets: true } } },
    orderBy: { name: 'asc' },
    // Unfiltered calls (admin's Junctions list, which paginates/searches
    // client-side) need the whole table now that it holds hundreds of rows;
    // a live search stays capped since it's meant to return a short list.
    take: typeof q === 'string' && q.trim() ? 12 : 1000,
  });
  res.json(stations);
});

// GET /api/stations/template — downloadable CSV template for bulk import
stationsRouter.get('/template', (req, res) => {
  const csv = [
    'name,code,state,zone',
    'New Delhi,NDLS,Delhi,NR',
    'Kanpur Central,CNB,Uttar Pradesh,NCR',
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="stations-template.csv"');
  res.send(csv);
});

// POST /api/stations/bulk-import — multipart/form-data: file (CSV, columns: name,code,state,zone)
// Rows are validated up front; only valid, non-duplicate rows are written, in one transaction.
// Existing codes are skipped (not overwritten) — re-uploading the same file twice is a no-op.
stationsRouter.post('/bulk-import', requireAdminAuth, csvUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Attach a CSV file under the "file" field.' });
  }

  let rows: Record<string, string>[];
  try {
    rows = parse(req.file.buffer.toString('utf-8'), {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse that file as CSV.' });
  }

  if (rows.length === 0) {
    return res.status(400).json({ error: 'The file has no data rows.' });
  }
  if (rows.length > 2000) {
    return res.status(400).json({ error: 'Max 2000 rows per import — split into batches.' });
  }

  const existingCodes = new Set(
    (await prisma.station.findMany({ select: { code: true } })).map((s) => s.code.toUpperCase()),
  );

  const errors: { row: number; reason: string }[] = [];
  const toCreate: { name: string; code: string; state?: string; zone?: string }[] = [];
  const seenInFile = new Set<string>();

  rows.forEach((row, i) => {
    const rowNum = i + 2; // +1 for header, +1 for 1-indexing
    const name = row.name?.trim();
    const code = row.code?.trim().toUpperCase();

    if (!name || !code) {
      errors.push({ row: rowNum, reason: 'Missing name or code' });
      return;
    }
    if (!/^[A-Z0-9]{1,10}$/.test(code)) {
      errors.push({ row: rowNum, reason: `Invalid code "${code}" — use 1-10 letters/digits` });
      return;
    }
    if (existingCodes.has(code) || seenInFile.has(code)) {
      errors.push({ row: rowNum, reason: `Code "${code}" already exists — skipped` });
      return;
    }
    seenInFile.add(code);
    toCreate.push({ name, code, state: row.state?.trim() || undefined, zone: row.zone?.trim() || undefined });
  });

  if (toCreate.length > 0) {
    await prisma.station.createMany({ data: toCreate });
  }

  res.json({
    totalRows: rows.length,
    created: toCreate.length,
    skipped: errors.length,
    errors: errors.slice(0, 100), // cap the payload if someone uploads a genuinely messy file
  });
});

// GET /api/stations/:code — public station landing page: station details plus
// its live, approved vendors only. Deliberately a `select`, not `include: { outlets: true }`
// — an outlet row also carries passwordHash/mustChangePassword for its own vendor
// login, which must never reach this public, unauthenticated endpoint.
stationsRouter.get('/:code', async (req, res) => {
  const station = await prisma.station.findUnique({
    where: { code: req.params.code.toUpperCase() },
    select: {
      id: true,
      code: true,
      name: true,
      state: true,
      zone: true,
      isActive: true,
      outlets: {
        where: { isActive: true, status: 'APPROVED' },
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          foodTypes: true,
          deliveryCharge: true,
          minOrderValue: true,
          minOrderTimeMins: true,
          workingHoursStart: true,
          workingHoursEnd: true,
          weeklyOff: true,
          availability: true,
          _count: { select: { menuItems: true } },
        },
      },
    },
  });
  if (!station) return res.status(404).json({ error: 'Station not found' });
  res.json({ ...station, outlets: station.outlets.map(withStatus) });
});

// POST /api/stations — create a single junction
stationsRouter.post('/', requireAdminAuth, async (req, res) => {
  const { code, name, state, zone } = req.body;
  if (!code || !name) {
    return res.status(400).json({ error: 'code and name are required' });
  }
  const existing = await prisma.station.findUnique({ where: { code: String(code).toUpperCase() } });
  if (existing) {
    return res.status(409).json({ error: `Station code "${code}" already exists.` });
  }
  const station = await prisma.station.create({
    data: { code: String(code).toUpperCase(), name, state, zone },
    include: { _count: { select: { outlets: true } } },
  });
  res.status(201).json(station);
});

// PATCH /api/stations/id/:id — update a junction
stationsRouter.patch('/id/:id', requireAdminAuth, async (req, res) => {
  const { name, code, state, zone, isActive } = req.body ?? {};
  const existing = await prisma.station.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Station not found' });

  if (code && String(code).toUpperCase() !== existing.code) {
    const clash = await prisma.station.findUnique({ where: { code: String(code).toUpperCase() } });
    if (clash) return res.status(409).json({ error: `Station code "${code}" already exists.` });
  }

  const station = await prisma.station.update({
    where: { id: req.params.id },
    data: {
      name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
      code: typeof code === 'string' && code.trim() ? code.trim().toUpperCase() : undefined,
      state: state !== undefined ? state : undefined,
      zone: zone !== undefined ? zone : undefined,
      isActive: isActive !== undefined ? Boolean(isActive) : undefined,
    },
    include: { _count: { select: { outlets: true } } },
  });
  res.json(station);
});

// DELETE /api/stations/id/:id — blocked while outlets still reference it
stationsRouter.delete('/id/:id', requireAdminAuth, async (req, res) => {
  const station = await prisma.station.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { outlets: true } } },
  });
  if (!station) return res.status(404).json({ error: 'Station not found' });

  if (station._count.outlets > 0) {
    return res.status(409).json({
      error: `${station._count.outlets} outlet(s) are assigned to this station. Deactivate it instead of deleting.`,
    });
  }

  await prisma.station.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
