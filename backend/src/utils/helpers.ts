export function normalizeCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 80);
}

export function dateFromQuery(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date filter');
  }
  return date;
}

export function requestRateLimitKey(request: any, scope: string, suffix = ''): string {
  return `${scope}:${request.ip}:${suffix}`;
}


export function sanitizeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(sanitizeBigInt);
  if (typeof obj === 'object') {
    const result: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = sanitizeBigInt(obj[key]);
      }
    }
    return result;
  }
  return obj;
}
