import type { VaultItem, SharingPolicy, Permission } from '@core/vault/types';

export interface ShareItemParams {
  item: VaultItem;
  targetUserId: string;
  permissions: Permission;
  ownerId: string;
}

export function shareItem(
  item: VaultItem,
  targetUserId: string,
  permissions: Permission
): VaultItem {
  const existingShare = item.sharedWith.find((s) => s.userId === targetUserId);

  if (existingShare && !existingShare.revokedAt) {
    return {
      ...item,
      sharedWith: item.sharedWith.map((s) =>
        s.userId === targetUserId ? { ...s, permissions } : s
      ),
    };
  }

  const newShare: SharingPolicy = {
    userId: targetUserId,
    permissions,
    grantedAt: new Date().toISOString(),
  };

  return {
    ...item,
    sharedWith: [...item.sharedWith.filter((s) => s.userId !== targetUserId), newShare],
  };
}

export function revokeSharing(item: VaultItem, targetUserId: string): VaultItem {
  return {
    ...item,
    sharedWith: item.sharedWith.map((s) =>
      s.userId === targetUserId
        ? { ...s, revokedAt: new Date().toISOString() }
        : s
    ),
  };
}

export function getActiveShares(item: VaultItem): SharingPolicy[] {
  return item.sharedWith.filter((s) => !s.revokedAt);
}

export function canAccess(item: VaultItem, userId: string): boolean {
  if (item.ownerId === userId) return true;

  const share = item.sharedWith.find((s) => s.userId === userId);
  return share !== undefined && !share.revokedAt;
}

export function canWrite(item: VaultItem, userId: string): boolean {
  if (item.ownerId === userId) return true;

  const share = item.sharedWith.find((s) => s.userId === userId);
  return share !== undefined && !share.revokedAt && (share.permissions === 'write' || share.permissions === 'admin');
}

export function canAdmin(item: VaultItem, userId: string): boolean {
  if (item.ownerId === userId) return true;

  const share = item.sharedWith.find((s) => s.userId === userId);
  return share !== undefined && !share.revokedAt && share.permissions === 'admin';
}

export function getShareSummary(item: VaultItem): { total: number; active: number; revoked: number } {
  const active = getActiveShares(item).length;
  const revoked = item.sharedWith.length - active;
  return { total: item.sharedWith.length, active, revoked };
}
