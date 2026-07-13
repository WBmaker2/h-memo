const INVALID_DATE_LABEL = "날짜 정보 없음";
const DEFAULT_TIME_ZONE = "Asia/Seoul";

function normalizeKoreanDayPeriod(
  part: Intl.DateTimeFormatPart,
  isKoreanLocale: boolean
): string {
  if (!isKoreanLocale || part.type !== "dayPeriod") {
    return part.value;
  }

  if (part.value === "AM") {
    return "오전";
  }

  if (part.value === "PM") {
    return "오후";
  }

  return part.value;
}

export function formatDateTime(
  value: string,
  locale = "ko-KR",
  timeZone = DEFAULT_TIME_ZONE
): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return INVALID_DATE_LABEL;
  }

  const date = new Date(trimmedValue);
  if (Number.isNaN(date.getTime())) {
    return INVALID_DATE_LABEL;
  }

  const isKoreanLocale = locale.toLowerCase().startsWith("ko");
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    timeZone,
  })
    .formatToParts(date)
    .map((part) => normalizeKoreanDayPeriod(part, isKoreanLocale))
    .join("");
}
