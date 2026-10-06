export type EffectiveAvailability = 'OPEN' | 'BUSY' | 'CLOSED';
export type ClosedReason = 'MANUAL' | 'OUTSIDE_HOURS' | 'WEEKLY_OFF';

export type OutletStatus = {
  effectiveAvailability: EffectiveAvailability;
  closedReason: ClosedReason | null;
  // Human-readable line for the storefront, e.g. "Opens at 10:00".
  statusNote: string | null;
};

type OutletTiming = {
  availability: 'OPEN' | 'BUSY' | 'TEMPORARILY_CLOSED';
  workingHoursStart: string;
  workingHoursEnd: string;
  weeklyOff: string;
};

function istNow(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  return {
    day: get('weekday').toUpperCase(),
    minutes: hour * 60 + Number(get('minute')),
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function getOutletStatus(outlet: OutletTiming, now: Date = new Date()): OutletStatus {
  const { day, minutes } = istNow(now);

  if (outlet.weeklyOff !== 'NONE' && outlet.weeklyOff === day) {
    return { effectiveAvailability: 'CLOSED', closedReason: 'WEEKLY_OFF', statusNote: 'Closed today (weekly off)' };
  }

  const start = toMinutes(outlet.workingHoursStart);
  const end = toMinutes(outlet.workingHoursEnd);
  // end <= start means the kitchen runs past midnight (e.g. 18:00 to 02:00).
  const withinHours = start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;

  if (!withinHours) {
    return {
      effectiveAvailability: 'CLOSED',
      closedReason: 'OUTSIDE_HOURS',
      statusNote: `Closed now · opens at ${outlet.workingHoursStart}`,
    };
  }

  if (outlet.availability === 'TEMPORARILY_CLOSED') {
    return { effectiveAvailability: 'CLOSED', closedReason: 'MANUAL', statusNote: 'Temporarily closed' };
  }

  if (outlet.availability === 'BUSY') {
    return { effectiveAvailability: 'BUSY', closedReason: null, statusNote: 'Busy — orders may take longer' };
  }

  return { effectiveAvailability: 'OPEN', closedReason: null, statusNote: null };
}

export function withStatus<T extends OutletTiming>(outlet: T): T & OutletStatus {
  return { ...outlet, ...getOutletStatus(outlet) };
}
