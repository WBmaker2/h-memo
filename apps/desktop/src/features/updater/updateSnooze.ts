export type UpdateSnoozePeriod = "week" | "month";

export const UPDATE_SNOOZE_STORAGE_KEY = "h-memo:desktop-update-snoozed-until";

const UPDATE_SNOOZE_DURATION_MS: Record<UpdateSnoozePeriod, number> = {
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

type UpdateSnoozeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getDefaultStorage(): UpdateSnoozeStorage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function removeSnooze(storage: UpdateSnoozeStorage): void {
  try {
    storage.removeItem(UPDATE_SNOOZE_STORAGE_KEY);
  } catch {
    // A storage failure should never block an app update check.
  }
}

export function readUpdateSnoozeUntil(
  storage: UpdateSnoozeStorage | null = getDefaultStorage(),
  now = Date.now()
): number | null {
  if (!storage) return null;

  let rawValue: string | null;
  try {
    rawValue = storage.getItem(UPDATE_SNOOZE_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!rawValue) return null;

  const snoozedUntil = Number(rawValue);
  if (!Number.isSafeInteger(snoozedUntil) || snoozedUntil <= now) {
    removeSnooze(storage);
    return null;
  }

  return snoozedUntil;
}

export function saveUpdateSnooze(
  period: UpdateSnoozePeriod,
  storage: UpdateSnoozeStorage | null = getDefaultStorage(),
  now = Date.now()
): number | null {
  if (!storage) return null;

  const snoozedUntil = now + UPDATE_SNOOZE_DURATION_MS[period];
  try {
    storage.setItem(UPDATE_SNOOZE_STORAGE_KEY, String(snoozedUntil));
    return snoozedUntil;
  } catch {
    return null;
  }
}
