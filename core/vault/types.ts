export type VaultItemType = 'password' | 'passkey' | 'totp' | 'card' | 'note' | 'identity';

export type Permission = 'read' | 'write' | 'admin';

export type PasswordStrength = 'weak' | 'fair' | 'strong' | 'maximum';

export interface VaultAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  data?: string;
  createdAt: string;
}

export interface DeletedItem {
  item: VaultItem;
  deletedAt: string;
}

export interface VaultHealth {
  weak: number;
  reused: number;
  compromised: number;
  totpWithout2fa: number;
  expired: number;
  total: number;
  score: number;
}

export interface RecoveryKey {
  encryptedMasterKey: string;
  salt: string;
  hint: string;
  createdAt: string;
}

export interface PasskeyData {
  credentialId: string;
  publicKey: string;
  provider: string;
}

export interface CardData {
  number: string;
  expiry: string;
  cvc: string;
  cardholder: string;
  brand?: string;
}

export interface IdentityData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: string;
  document?: string;
}

export interface VaultItem {
  id: string;
  type: VaultItemType;
  title: string;
  url?: string;
  username?: string;
  password?: string;
  totpSeed?: string;
  passkey?: PasskeyData;
  card?: CardData;
  identity?: IdentityData;
  note?: string;
  attachments?: VaultAttachment[];
  createdAt: string;
  updatedAt: string;
  tags: string[];
  favorite: boolean;
  ownerId: string;
  collectionIds: string[];
  sharedWith: SharingPolicy[];
}

export interface SharingPolicy {
  userId: string;
  permissions: Permission;
  grantedAt: string;
  revokedAt?: string;
}

export interface Collection {
  id: string;
  name: string;
  ownerId: string;
  memberAccess: CollectionMemberAccess[];
  itemIds: string[];
}

export interface CollectionMemberAccess {
  userId: string;
  permissions: Permission;
}

export interface OrganizationMember {
  userId: string;
  role: OrgRole;
  joinedAt: string;
  lastActiveAt: string;
  twoFactorEnabled: boolean;
}

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface OrganizationPolicy {
  id: string;
  type: PolicyType;
  value: unknown;
  enforcedAt: string;
}

export type PolicyType =
  | 'min_password_strength'
  | 'require_2fa'
  | 'password_expiry_days'
  | 'max_shared_items';

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  members: OrganizationMember[];
  collections: Collection[];
  policies: OrganizationPolicy[];
  createdAt: string;
}

export interface AuditLog {
  id: string;
  orgId: string;
  userId: string;
  action: string;
  targetId?: string;
  details: Record<string, unknown>;
  timestamp: string;
  immutable: true;
}

export interface VaultFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  data: string;
  createdAt: string;
}

export interface VaultFolder {
  id: string;
  name: string;
  color: string;
  encryptedFiles: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthInfo {
  masterSalt: string;
  masterHash: string;
  duressSalt?: string;
  duressHash?: string;
  killSalt?: string;
  killHash?: string;
  dpapiMasterKey?: string;
}

export interface VaultData {
  items: VaultItem[];
  trash: DeletedItem[];
  collections: Collection[];
  organizations: Organization[];
  auditLogs: AuditLog[];
  folders: VaultFolder[];
  recoveryKey?: RecoveryKey;
  authInfo?: AuthInfo;
  version: number;
}
