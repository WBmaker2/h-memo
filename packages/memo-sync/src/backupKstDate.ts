export const BACKUP_TIME_ZONE = "Asia/Seoul";
export const BACKUP_RETENTION_DAYS = 365;

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BACKUP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function parseKstDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function toKstDateKey(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftKstDateKey(key: string, days: number): string {
  const date = parseKstDateKey(key);
  if (!date) throw new Error(`Invalid KST date key: ${key}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getKstRetentionStartKey(
  now: string | Date,
  retentionDays = BACKUP_RETENTION_DAYS
): string {
  const today = toKstDateKey(now);
  if (!today) throw new Error("Invalid retention clock");
  return shiftKstDateKey(today, -(retentionDays - 1));
}

export function getKstRetentionStartInstant(
  now: string | Date,
  retentionDays = BACKUP_RETENTION_DAYS,
): string {
  const startKey = getKstRetentionStartKey(now, retentionDays);
  return new Date(`${startKey}T00:00:00+09:00`).toISOString();
}

export function isKstDateInRetention(key: string, now: string | Date): boolean {
  const today = toKstDateKey(now);
  if (!today || !parseKstDateKey(key)) return false;
  return key >= getKstRetentionStartKey(now) && key <= today;
}
