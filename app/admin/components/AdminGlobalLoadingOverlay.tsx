"use client";

import { useEffect, useState } from "react";

const FADE_MS = 267;

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
      return () => {
        cancelled = true;
      };
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
      <style>{`@keyframes _adminGlobalSpin{to{transform:rotate(360deg)}}`}</style>
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
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "3px solid rgba(255, 255, 255, 0.35)",
            borderTopColor: "#fff",
            animation: "_adminGlobalSpin 0.7s linear infinite",
            boxShadow: "0 2px 16px rgba(0, 0, 0, 0.35)",
          }}
        />
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#f1f5f9",
            textShadow: "0 1px 2px rgba(0, 0, 0, 0.5)",
          }}
        >
          {caption}
        </span>
      </div>
    </>
  );
}
