"use client";

import { useEffect, useState } from "react";

const FADE_MS = 267;

const CSS = `
@keyframes _adminOvSpin {
  to { transform: rotate(360deg); }
}
@keyframes _adminOvDash {
  0%   { stroke-dasharray: 1 150;  stroke-dashoffset: 0; }
  50%  { stroke-dasharray: 90 150; stroke-dashoffset: -35; }
  100% { stroke-dasharray: 90 150; stroke-dashoffset: -124; }
}
._adminOvArc {
  animation: _adminOvDash 1.5s ease-in-out infinite;
}
`;

/** Semi-transparent black dimmer; shell stays visible underneath. Fades in/out via layer opacity. */
export function AdminGlobalLoadingOverlay({ message }: { message: string | null }) {
  const [layerOpen, setLayerOpen] = useState(() => message != null);
  const [visible, setVisible] = useState(false);
  const [caption, setCaption] = useState(() => message ?? "");

  useEffect(() => {
    if (message) {
      let cancelled = false;
      setCaption(message);
      setLayerOpen(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setVisible(true);
        });
      });
      return () => { cancelled = true; };
    }
    setVisible(false);
  }, [message]);

  function onOverlayTransitionEnd(e: React.TransitionEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget || e.propertyName !== "opacity") return;
    if (message) return;
    if (!visible) setLayerOpen(false);
  }

  if (!layerOpen) return null;

  return (
    <>
      <style>{CSS}</style>
      <div
        onTransitionEnd={onOverlayTransitionEnd}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.4)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 200,
          gap: 14,
          opacity: visible ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease`,
          pointerEvents: visible ? "auto" : "none",
        }}
      >
        <svg
          width="36"
          height="36"
          viewBox="0 0 44 44"
          style={{ animation: "_adminOvSpin 1.5s linear infinite", display: "block" }}
        >
          <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
          <circle cx="22" cy="22" r="18" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" className="_adminOvArc" />
        </svg>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#f1f5f9",
            textShadow: "0 1px 2px rgba(0,0,0,0.5)",
          }}
        >
          {caption}
        </span>
      </div>
    </>
  );
}
