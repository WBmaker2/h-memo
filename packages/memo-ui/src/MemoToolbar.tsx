import type { ChangeEvent } from "react";
import type { MemoStyle } from "@h-memo/memo-core";

import { fontFamilies, memoBackgrounds, textColors } from "./theme";

type MemoToolbarProps = {
  style: MemoStyle;
  onStyleChange: (style: Partial<MemoStyle>) => void;
  onDelete: () => void;
  showDeleteAction?: boolean;
  isDisabled?: boolean;
};

export function MemoToolbar({
  style,
  onStyleChange,
  onDelete,
  showDeleteAction = true,
  isDisabled = false,
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
      <section className="memo-toolbar__section">
        <h3 className="memo-toolbar__section-title">배경색</h3>
        <div className="memo-toolbar__row">
          {memoBackgrounds.map((background) => (
            <button
              key={background.value}
              type="button"
              className="memo-toolbar__color-button"
              aria-label={background.label}
              aria-pressed={style.backgroundColor === background.value}
              title={background.label}
              disabled={isDisabled}
              onClick={() => onStyleChange({ backgroundColor: background.value })}
              style={{
                backgroundColor: background.value,
                width: "2.5rem",
                height: "2.5rem",
                border: style.backgroundColor === background.value ? "2px solid #111827" : "1px solid transparent",
              }}
            />
          ))}
        </div>
      </section>
      <section className="memo-toolbar__section">
        <h3 className="memo-toolbar__section-title">폰트</h3>
        <label>
          글꼴
          <select
            aria-label="글꼴"
            value={style.fontFamily}
            onChange={handleFontChange}
            disabled={isDisabled}
          >
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
            disabled={isDisabled}
          />
        </label>
      </section>
      <section className="memo-toolbar__section">
        <h3 className="memo-toolbar__section-title">글자 색</h3>
        <div className="memo-toolbar__row">
          {textColors.map((textColor) => (
            <button
              key={textColor.value}
              type="button"
              className="memo-toolbar__color-button"
              aria-label={textColor.label}
              aria-pressed={style.textColor === textColor.value}
              title={textColor.label}
              disabled={isDisabled}
              onClick={() => onStyleChange({ textColor: textColor.value })}
              style={{
                backgroundColor: textColor.value,
                width: "2.5rem",
                height: "2.5rem",
                border: style.textColor === textColor.value ? "2px solid #111827" : "1px solid transparent",
                borderRadius: "50%",
              }}
            />
          ))}
        </div>
      </section>
      {showDeleteAction ? (
        <section className="memo-toolbar__section">
          <h3 className="memo-toolbar__section-title">메모 동작</h3>
          <div className="memo-toolbar__row">
            <button
              type="button"
              className="memo-toolbar__delete-action destructive-action"
              aria-label="메모 삭제"
              title="메모 삭제"
              onClick={onDelete}
              disabled={isDisabled}
            >
              삭제
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
