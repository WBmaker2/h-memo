import type { ChangeEvent } from "react";
import type { MemoStyle } from "@h-memo/memo-core";

import { fontFamilies, memoBackgrounds, textColors } from "./theme";

type MemoToolbarProps = {
  style: MemoStyle;
  onStyleChange: (style: Partial<MemoStyle>) => void;
  onHide: () => void;
  onDelete: () => void;
};

export function MemoToolbar({
  style,
  onStyleChange,
  onHide,
  onDelete,
}: MemoToolbarProps) {
  const handleFontChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onStyleChange({ fontFamily: event.target.value });
  };

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    if (!Number.isNaN(value) && value > 0) {
      onStyleChange({ fontSize: value });
    }
  };

  return (
    <div className="memo-toolbar">
      <div className="memo-toolbar__row">
        {memoBackgrounds.map((background) => (
          <button
            key={background.value}
            type="button"
            aria-label={background.label}
            aria-pressed={style.backgroundColor === background.value}
            onClick={() => onStyleChange({ backgroundColor: background.value })}
            style={{
              backgroundColor: background.value,
              width: "1.5rem",
              height: "1.5rem",
              border: style.backgroundColor === background.value ? "2px solid #111827" : "1px solid transparent",
            }}
          />
        ))}
      </div>
      <label>
        글꼴
        <select aria-label="글꼴" value={style.fontFamily} onChange={handleFontChange}>
          {fontFamilies.map((fontFamily) => (
            <option key={fontFamily} value={fontFamily}>
              {fontFamily}
            </option>
          ))}
        </select>
      </label>
      <label>
        글자 크기
        <input
          aria-label="글자 크기"
          type="number"
          value={style.fontSize}
          min={10}
          max={48}
          onChange={handleSizeChange}
        />
      </label>
      <div className="memo-toolbar__row">
        {textColors.map((textColor) => (
          <button
            key={textColor.value}
            type="button"
            aria-label={textColor.label}
            aria-pressed={style.textColor === textColor.value}
            onClick={() => onStyleChange({ textColor: textColor.value })}
            style={{
              backgroundColor: textColor.value,
              width: "1.5rem",
              height: "1.5rem",
              border: style.textColor === textColor.value ? "2px solid #111827" : "1px solid transparent",
              borderRadius: "50%",
            }}
          />
        ))}
      </div>
      <div className="memo-toolbar__row">
        <button type="button" aria-label="메모 숨기기" onClick={onHide}>
          숨기기
        </button>
        <button type="button" aria-label="메모 삭제" onClick={onDelete}>
          삭제
        </button>
      </div>
    </div>
  );
}
