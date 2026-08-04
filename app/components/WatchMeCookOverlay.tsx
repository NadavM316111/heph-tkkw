"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { speakText } from "../../lib/watch-cook-utils";

interface WatchMeCookOverlayProps {
  onStop: () => void;
  stepInstruction?: string;
}

interface SubstituteCard {
  ingredient: string;
  suggestion: string;
  ts: number;
}

export default function WatchMeCookOverlay({
  onStop,
  stepInstruction,
}: WatchMeCookOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [checking, setChecking] = useState(false);
  const [commentaryLog, setCommentaryLog] = useState<{ text: string; ts: number; isError?: boolean }[]>([]);
  const [autoStopToast, setAutoStopToast] = useState(false);
  const [livePulse, setLivePulse] = useState(true);
  const [substituteCard, setSubstituteCard] = useState<SubstituteCard | null>(null);
  const [substituteLoading, setSubstituteLoading] = useState(false);
  const commentaryEndRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const listeningRef = useRef(false);

  // Pulse the LIVE badge
  useEffect(() => {
    const id = setInterval(() => setLivePulse((p) => !p), 800);
    return () => clearInterval(id);
  }, []);

  // Start camera on mount
  useEffect(() => {
    let active = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setCameraReady(true);
      })
      .catch(() => {
        if (active) setCameraError("Camera unavailable — allow camera access and reload.");
      });

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Elapsed-time counter
  useEffect(() => {
    const id = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll commentary to bottom
  useEffect(() => {
    commentaryEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [commentaryLog]);

  // ── Substitute via voice ──────────────────────────────────────────────
  const triggerSubstitute = useCallback(async (ingredient: string) => {
    if (!ingredient.trim()) return;
    setSubstituteLoading(true);
    addCommentary(`🔄 Looking for a substitute for "${ingredient}"…`);
    try {
      const res = await fetch("/api/substitute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredient }),
      });
      if (!res.ok) throw new Error("Substitute lookup failed");
      const data = await res.json();
      // Accept either { suggestion } or { substitute } from the endpoint
      const suggestion: string =
        data.suggestion ?? data.substitute ?? data.text ?? "No substitute found.";
      setSubstituteCard({ ingredient, suggestion, ts: Date.now() });
      addCommentary(`💡 Substitute for ${ingredient}: ${suggestion}`);
      // Stop recognition while speaking so it doesn't hear itself
      if (recognitionRef.current && listeningRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        listeningRef.current = false;
      }
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(
        `For ${ingredient}, you can use: ${suggestion}`
      );
      utt.rate = 0.95;
      utt.lang = "en-US";
      utt.onend = () => {
        // Resume listening after speaking
        if (recognitionRef.current && !listeningRef.current) {
          try { recognitionRef.current.start(); listeningRef.current = true; } catch { /* ignore */ }
        }
      };
      window.speechSynthesis.speak(utt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Substitute lookup failed";
      addCommentary(msg, true);
    } finally {
      setSubstituteLoading(false);
    }
  }, [addCommentary]);

  // ── Voice command listener ────────────────────────────────────────────
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ??
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return; // browser doesn't support it

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      const last = event.results[event.results.length - 1];
      if (!last.isFinal) return;
      const transcript: string = last[0].transcript.trim().toLowerCase();

      // Match "substitute X", "I don't have X", "i dont have X", "replace X"
      const patterns = [
        /\bsubstitute\s+(?:for\s+)?(.+)/,
        /\bi\s+don'?t\s+have\s+(.+)/,
        /\breplace\s+(?:the\s+)?(.+)/,
      ];
      for (const pattern of patterns) {
        const match = transcript.match(pattern);
        if (match) {
          // Clean trailing filler words
          const ingredient = match[1]
            .replace(/\b(please|with what|with something else|today|now)\b/g, "")
            .trim();
          if (ingredient) {
            triggerSubstitute(ingredient);
          }
          break;
        }
      }
    };

    recognition.onerror = (event: any) => {
      // "no-speech" is harmless — just restart
      if (event.error === "no-speech" || event.error === "aborted") return;
      listeningRef.current = false;
    };

    recognition.onend = () => {
      listeningRef.current = false;
      // Auto-restart unless we deliberately stopped (e.g. while speaking)
      if (recognitionRef.current === recognition) {
        try { recognition.start(); listeningRef.current = true; } catch { /* ignore */ }
      }
    };

    try {
      recognition.start();
      listeningRef.current = true;
    } catch { /* ignore */ }

    return () => {
      recognitionRef.current = null;
      listeningRef.current = false;
      try { recognition.stop(); } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // start once on mount; triggerSubstitute is stable via useCallback

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const addCommentary = useCallback((text: string, isError = false) => {
    setCommentaryLog((prev) => [...prev.slice(-19), { text, ts: Date.now(), isError }]);
  }, []);

  /**
   * Captures a frame, asks the AI, updates state, and returns
   * { hasChange, text } so callers can decide whether / how to speak.
   */
  const checkPan = useCallback(
    async (silent = false): Promise<{ hasChange: boolean; text: string }> => {
      if (!videoRef.current || !canvasRef.current || checking)
        return { hasChange: false, text: "" };
      setChecking(true);

      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.85)
        );
        if (!blob) throw new Error("Could not capture frame");

        const formData = new FormData();
        formData.append("file", blob, "pan-check.jpg");
        const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const { url } = await uploadRes.json();

        const contextText = stepInstruction
          ? `The cook is currently on this step: "${stepInstruction}". `
          : "";

        const aiRes = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system:
              "You are a helpful cooking assistant watching someone cook via their phone camera. Give a short (1–2 sentence) practical observation about what you see and whether it looks on track, needs attention, or is done. If nothing notable has changed and everything looks fine, reply with exactly the word NOCHANGE and nothing else. Be encouraging but honest. No markdown.",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: contextText + "Please check what I'm cooking and tell me how it looks.",
                  },
                  { type: "image_url", image_url: { url } },
                ],
              },
            ],
          }),
        });
        if (!aiRes.ok) throw new Error("AI check failed");
        const { text } = await aiRes.json();

        const hasChange = text.trim().toUpperCase() !== "NOCHANGE";

        if (hasChange) {
          addCommentary(text);
          if (!silent && "speechSynthesis" in window) {
            window.speechSynthesis.cancel();
            const utt = new SpeechSynthesisUtterance(text);
            utt.rate = 0.95;
            utt.lang = "en-US";
            window.speechSynthesis.speak(utt);
          }
        }

        return { hasChange, text };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        addCommentary(msg, true);
        return { hasChange: false, text: "" };
      } finally {
        setChecking(false);
      }
    },
    [checking, stepInstruction, addCommentary]
  );

  // ── 20-minute auto-stop ───────────────────────────────────────────────
  useEffect(() => {
    if (elapsedSeconds < 1200) return;
    window.speechSynthesis?.cancel();
    setAutoStopToast(true);
    const id = setTimeout(() => { onStop(); }, 3000);
    return () => clearTimeout(id);
  }, [elapsedSeconds, onStop]);

  // ── 60-second auto-check loop ─────────────────────────────────────────
  useEffect(() => {
    if (!cameraReady) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const loop = () => {
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        const { hasChange, text } = await checkPan(true);
        if (!cancelled && hasChange && text) {
          await speakText(text).catch(() => { /* ignore */ });
        }
        if (!cancelled) loop();
      }, 60_000);
    };

    loop();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraReady]);

  return (
    <div style={S.root}>
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* ── Full-screen camera feed ── */}
      <div style={S.videoWrap}>
        {cameraReady ? (
          <video
            ref={videoRef}
            style={S.video}
            autoPlay
            playsInline
            muted
          />
        ) : (
          <div style={S.videoPlaceholder}>
            {cameraError ? (
              <div style={S.cameraErrorBox}>
                <span style={{ fontSize: 32 }}>📷</span>
                <p style={{ color: "#FF6B6B", fontSize: 14, textAlign: "center", margin: "8px 0 0" }}>
                  {cameraError}
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 40 }}>📷</span>
                <p style={{ color: "#888", fontSize: 14, margin: 0 }}>Starting camera…</p>
              </div>
            )}
          </div>
        )}

        {/* Top bar — LIVE badge + timer + stop */}
        <div style={S.topBar}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ ...S.liveDot, opacity: livePulse ? 1 : 0.3 }} />
            <span style={S.liveLabel}>LIVE</span>
          </div>
          <span style={S.timer}>{formatTime(elapsedSeconds)}</span>
          <button style={S.stopBtnTop} onClick={onStop}>⏹ Stop</button>
        </div>

        {/* Current step pill */}
        {stepInstruction && (
          <div style={S.stepPill}>
            <span style={S.stepPillEmoji}>👨‍🍳</span>
            <span style={S.stepPillText} title={stepInstruction}>
              {stepInstruction.length > 70
                ? stepInstruction.slice(0, 67) + "…"
                : stepInstruction}
            </span>
          </div>
        )}
      </div>

      {/* ── Commentary panel ── */}
      <div style={S.panel}>

        {/* Substitute card */}
        {substituteCard && (
          <div style={S.subCard}>
            <div style={S.subCardTop}>
              <span style={S.subCardBadge}>🔄 Swap</span>
              <button
                style={S.subCardDismiss}
                onClick={() => setSubstituteCard(null)}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
            <div style={S.subCardBody}>
              <span style={S.subCardIngredient}>
                {substituteCard.ingredient}
              </span>
              <span style={S.subCardArrow}>→</span>
              <span style={S.subCardSuggestion}>
                {substituteCard.suggestion}
              </span>
            </div>
            {substituteLoading && (
              <span style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>
                Updating…
              </span>
            )}
          </div>
        )}

        {/* Panel header */}
        <div style={S.panelHeader}>
          <span style={S.panelTitle}>
            🤖 AI Commentary
            {listeningRef.current && (
              <span style={S.micBadge} title="Listening for voice commands">🎙</span>
            )}
          </span>
          <button
            style={{ ...S.checkBtn, opacity: checking || !cameraReady ? 0.5 : 1 }}
            onClick={() => checkPan()}
            disabled={checking || !cameraReady}
          >
            {checking ? (
              <><span style={S.spinner} /> Checking…</>
            ) : (
              <>🍳 Check now</>
            )}
          </button>
        </div>

        {/* Commentary log */}
        <div style={S.log}>
          {commentaryLog.length === 0 ? (
            <div style={S.emptyLog}>
              <span style={{ fontSize: 28 }}>👁️</span>
              <p style={{ color: "#555", fontSize: 13, margin: "8px 0 0", textAlign: "center" }}>
                AI will check your cooking every 60 seconds.{"\n"}Tap "Check now" any time.
              </p>
            </div>
          ) : (
            commentaryLog.map((entry) => (
              <div key={entry.ts} style={{ ...S.logEntry, borderLeftColor: entry.isError ? "#FF6B6B" : "#FF6B35" }}>
                <span style={{ ...S.logText, color: entry.isError ? "#FF6B6B" : "#e8e8e8" }}>
                  {entry.isError ? "⚠ " : ""}
                  {entry.text}
                </span>
                <span style={S.logTime}>
                  {new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </div>
            ))
          )}
          <div ref={commentaryEndRef} />
        </div>
      </div>

      {/* Auto-stop toast */}
      {autoStopToast && (
        <div style={S.toast}>
          ⏱ 20 minutes reached — stopping session…
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  root: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    background: "#000",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },

  // ── Camera ────────────────────────────────────────────────────────────
  videoWrap: {
    position: "relative",
    flex: "0 0 55dvh",
    minHeight: 220,
    background: "#0a0a0a",
    overflow: "hidden",
  },
  video: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  videoPlaceholder: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0f0f0f",
  },
  cameraErrorBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "0 32px",
  },

  // ── Top bar ───────────────────────────────────────────────────────────
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)",
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#FF3B30",
    flexShrink: 0,
    transition: "opacity 0.3s",
  },
  liveLabel: {
    color: "#fff",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 1.5,
  },
  timer: {
    color: "#fff",
    fontSize: 14,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    background: "rgba(0,0,0,0.45)",
    borderRadius: 8,
    padding: "3px 8px",
  },
  stopBtnTop: {
    background: "rgba(255,59,48,0.85)",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    backdropFilter: "blur(4px)",
  },

  // ── Step pill ─────────────────────────────────────────────────────────
  stepPill: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    background: "rgba(0,0,0,0.72)",
    backdropFilter: "blur(8px)",
    borderRadius: 12,
    padding: "10px 14px",
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    border: "1px solid rgba(255,255,255,0.1)",
  },
  stepPillEmoji: {
    fontSize: 16,
    flexShrink: 0,
    marginTop: 1,
  },
  stepPillText: {
    color: "#fff",
    fontSize: 13,
    lineHeight: 1.45,
    fontWeight: 500,
  },

  // ── Commentary panel ──────────────────────────────────────────────────
  panel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    background: "#111",
    overflow: "hidden",
    borderTop: "1px solid #222",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: "1px solid #1e1e1e",
    background: "#141414",
    flexShrink: 0,
  },
  panelTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: 700,
  },
  checkBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#FF6B35",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  log: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 16px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  emptyLog: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 0",
  },
  logEntry: {
    background: "#1a1a1a",
    borderRadius: 12,
    borderLeft: "3px solid #FF6B35",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  logText: {
    fontSize: 14,
    lineHeight: 1.5,
  },
  logTime: {
    color: "#555",
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },

  // ── Spinner ───────────────────────────────────────────────────────────
  spinner: {
    display: "inline-block",
    width: 12,
    height: 12,
    border: "2px solid rgba(255,255,255,0.3)",
    borderTop: "2px solid #fff",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },

  // ── Substitute card ───────────────────────────────────────────────────
  subCard: {
    margin: "10px 12px 0",
    background: "#1c1a14",
    border: "1px solid rgba(255, 200, 60, 0.35)",
    borderRadius: 14,
    padding: "10px 14px",
    flexShrink: 0,
  },
  subCardTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  subCardBadge: {
    fontSize: 12,
    fontWeight: 700,
    color: "#FFD95A",
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
  },
  subCardDismiss: {
    background: "none",
    border: "none",
    color: "#666",
    fontSize: 14,
    cursor: "pointer",
    padding: "0 2px",
    lineHeight: 1,
  },
  subCardBody: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    flexWrap: "wrap" as const,
  },
  subCardIngredient: {
    color: "#FF6B6B",
    fontWeight: 700,
    fontSize: 14,
    textDecoration: "line-through",
    opacity: 0.9,
  },
  subCardArrow: {
    color: "#555",
    fontSize: 16,
    fontWeight: 700,
    flexShrink: 0,
  },
  subCardSuggestion: {
    color: "#e8e8e8",
    fontSize: 14,
    lineHeight: 1.45,
    flex: 1,
  },
  micBadge: {
    marginLeft: 6,
    fontSize: 13,
    opacity: 0.7,
    verticalAlign: "middle",
  },

  // ── Toast ─────────────────────────────────────────────────────────────
  toast: {
    position: "absolute",
    top: 70,
    left: 16,
    right: 16,
    background: "rgba(20,20,20,0.97)",
    border: "1px solid rgba(255,107,53,0.5)",
    borderRadius: 14,
    padding: "14px 18px",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    textAlign: "center",
    boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
    zIndex: 300,
    pointerEvents: "none",
  },
};