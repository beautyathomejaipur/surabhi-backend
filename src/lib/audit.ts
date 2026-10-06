import { prisma } from './prisma.js';

type AuditInput = {
  actorType: 'STAFF' | 'VENDOR' | 'SYSTEM';
  actorId?: string;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
};

// Fire-and-forget by design: an audit-write failure must never fail the
// request it's describing.
export function recordAudit(input: AuditInput): void {
  prisma.auditLog
    .create({ data: { ...input, metadata: input.metadata as never } })
    .catch((err) => {
      console.error('Failed to write audit log', input.action, err);
    });
}
