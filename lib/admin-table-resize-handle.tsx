"use client";

import type { MouseEvent } from "react";

type Props = {
  ariaLabel: string;
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
};

/** Spec 차트 표와 동일 톤의 열 경계 드래그 핸들 */
export function AdminTableResizeHandle({ ariaLabel, onMouseDown }: Props) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      title="열 너비 조절"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMouseDown(e);
      }}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: 6,
        cursor: "col-resize",
        zIndex: 2,
        touchAction: "none",
        marginRight: -1,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(37,99,235,0.12)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    />
  );
}
