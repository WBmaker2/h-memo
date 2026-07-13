export const BACKUP_TIME_ZONE = "Asia/Seoul";
export const BACKUP_RETENTION_DAYS = 365;

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BACKUP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toKstDateKey(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftKstDateKey(key: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new Error(`Invalid KST date key: ${key}`);

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
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

export function isKstDateInRetention(key: string, now: string | Date): boolean {
  const today = toKstDateKey(now);
  if (!today) return false;
  return key >= getKstRetentionStartKey(now) && key <= today;
}
