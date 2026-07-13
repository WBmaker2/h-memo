const INVALID_DATE_LABEL = "날짜 정보 없음";

export function formatDateTime(value: string, locale = "ko-KR"): string {
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
  })
    .formatToParts(date)
    .map((part) => {
      if (!isKoreanLocale || part.type !== "dayPeriod") {
        return part.value;
      }

      return part.value === "AM" ? "오전" : part.value === "PM" ? "오후" : part.value;
    })
    .join("");
}
