const INVALID_DATE_LABEL = "날짜 정보 없음";

export function formatDateTime(value: string, locale = "ko-KR"): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return INVALID_DATE_LABEL;
  }

  const date = new Date(trimmedValue);
  return Number.isNaN(date.getTime()) ? INVALID_DATE_LABEL : date.toLocaleString(locale);
}
