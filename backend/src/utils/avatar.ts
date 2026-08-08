import { createHash } from 'node:crypto';

export const MAX_AVATAR_BYTES = 3 * 1024 * 1024;

export interface DecodedAvatar {
  mimeType: string;
  data: Buffer;
}

/**
 * Convert the stored avatar value into a small, cacheable public URL.
 * Data URLs are kept private in the database and are never sent in API
 * response bodies. Existing URL/path values remain backwards compatible.
 */
export function avatarUrlFor(userId: string, avatar?: string | null): string | null {
  const source = avatar?.trim();
  if (!source) return null;

  if (!source.toLowerCase().startsWith('data:')) return source;

  const version = createHash('sha256').update(source).digest('hex').slice(0, 16);
  return `/api/v2/users/${encodeURIComponent(userId)}/avatar?v=${version}`;
}

/**
 * Remove the Data URL wrapper and decode an image avatar for the lazy avatar
 * endpoint. Invalid formats and oversized values are rejected.
 */
export function decodeAvatarDataUrl(value?: string | null): DecodedAvatar | null {
  const source = value?.trim();
  if (!source) return null;

  const comma = source.indexOf(',');
  if (comma <= 0) return null;

  const header = source.slice(0, comma);
  const payload = source.slice(comma + 1).replace(/\s+/g, '');
  const match = /^data:(image\/[a-z0-9!#$&^_.+-]+);base64$/i.exec(header);
  if (!match || !payload || payload.length % 4 === 1 || !/^[a-z0-9+/]*={0,2}$/i.test(payload)) {
    return null;
  }

  const data = Buffer.from(payload, 'base64');
  if (data.length === 0 || data.length > MAX_AVATAR_BYTES) return null;

  return { mimeType: match[1].toLowerCase(), data };
}

export function publicUser<T extends { id: string; avatar?: string | null }>(user: T) {
  const { avatar, ...rest } = user;
  return {
    ...rest,
    avatarUrl: avatarUrlFor(user.id, avatar),
  };
}
