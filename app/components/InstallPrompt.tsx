"use client";

import { useEffect, useState } from "react";

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [showIos, setShowIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    if (localStorage.getItem("installDismissed") === "1") return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (standalone) return;

    const onPrompt = (e: any) => {
      e.preventDefault();
      setDeferred(e);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos && isSafari) { setShowIos(true); setHidden(false); }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    localStorage.setItem("installDismissed", "1");
    setHidden(true);
  }

  async function install() {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setDeferred(null);
    setHidden(true);
  }

  if (hidden) return null;

  return (
    <div
      style={{
        position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 9999,
        background: "#111827", color: "#f9fafb",
        border: "1px solid rgba(255,255,255,.14)", borderRadius: 14,
        padding: "14px 16px", boxShadow: "0 12px 40px rgba(0,0,0,.45)",
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        maxWidth: 520, margin: "0 auto", fontSize: 15, lineHeight: 1.5,
      }}
    >
      <div style={{ flex: 1, minWidth: 200 }}>
        {showIos ? (
          <>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Put this on your home screen</div>
            <div style={{ fontSize: 14, opacity: 0.85 }}>
              Tap the share button at the bottom of Safari, scroll down, then tap Add to Home Screen.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Install the app</div>
            <div style={{ fontSize: 14, opacity: 0.85 }}>Opens full screen, works offline.</div>
          </>
        )}
      </div>
      {!showIos && (
        <button
          onClick={install}
          style={{
            background: "#e7d29a", color: "#1a1406", border: "none",
            borderRadius: 9, padding: "11px 18px", fontSize: 15,
            fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Install
        </button>
      )}
      <button
        onClick={dismiss}
        style={{
          background: "none", border: "none", color: "rgba(249,250,251,.6)",
          fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1,
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
