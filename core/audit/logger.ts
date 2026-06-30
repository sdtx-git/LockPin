import type { AuditLog } from '@core/vault/types';
import { generateId } from '@shared/utils';

const auditLogs: AuditLog[] = [];

export function createAuditLog(params: {
  orgId: string;
  userId: string;
  action: string;
  targetId?: string;
  details?: Record<string, unknown>;
}): AuditLog {
  const log: AuditLog = {
    id: generateId(),
    orgId: params.orgId,
    userId: params.userId,
    action: params.action,
    targetId: params.targetId,
    details: params.details ?? {},
    timestamp: new Date().toISOString(),
    immutable: true,
  };

  auditLogs.push(log);
  return log;
}

export function getAuditLogs(
  filters?: {
    orgId?: string;
    userId?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
  }
): AuditLog[] {
  return auditLogs.filter((log) => {
    if (filters?.orgId && log.orgId !== filters.orgId) return false;
    if (filters?.userId && log.userId !== filters.userId) return false;
    if (filters?.action && log.action !== filters.action) return false;
    if (filters?.startDate && log.timestamp < filters.startDate) return false;
    if (filters?.endDate && log.timestamp > filters.endDate) return false;
    return true;
  });
}

export function getAuditLogsPaginated(
  page: number,
  pageSize: number,
  filters?: Parameters<typeof getAuditLogs>[0]
): { logs: AuditLog[]; total: number; page: number; totalPages: number } {
  const filtered = getAuditLogs(filters);
  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const logs = filtered.slice(start, start + pageSize);

  return { logs, total, page, totalPages };
}

export function exportAuditLogs(format: 'csv' | 'json'): string {
  if (format === 'json') {
    return JSON.stringify(auditLogs, null, 2);
  }

  const headers = ['ID', 'OrgID', 'UserID', 'Action', 'TargetID', 'Timestamp'];
  const rows = auditLogs.map((log) =>
    [log.id, log.orgId, log.userId, log.action, log.targetId ?? '', log.timestamp].join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function clearAuditLogs(): void {
  auditLogs.length = 0;
}
