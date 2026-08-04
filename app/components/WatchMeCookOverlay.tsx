"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { speakText } from "../../lib/watch-cook-utils";

interface WatchMeCookOverlayProps {
  onStop: () => void;
  stepInstruction?: string;
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
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [checkError, setCheckError] = useState("");

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
        if (active) setCameraError("Camera unavailable");
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

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
      .toString()
      .padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  /**
   * Captures a frame, asks the AI, updates state, and returns
   * { hasChange, text } so callers can decide whether / how to speak.
   *
   * @param silent  When true the result is shown in the UI but NOT spoken
   *                (the auto-loop handles speaking itself so it can await it).
   */
  const checkPan = useCallback(
    async (silent = false): Promise<{ hasChange: boolean; text: string }> => {
      if (!videoRef.current || !canvasRef.current || checking)
        return { hasChange: false, text: "" };
      setChecking(true);
      setCheckResult(null);
      setCheckError("");

      try {
        // Capture current video frame
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Convert to blob
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.85)
        );
        if (!blob) throw new Error("Could not capture frame");

        // Upload frame
        const formData = new FormData();
        formData.append("file", blob, "pan-check.jpg");
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const { url } = await uploadRes.json();

        // Ask AI to evaluate what's in the pan
        const contextText = stepInstruction
          ? `The cook is currently on this step: "${stepInstruction}". `
          : "";

        const aiRes = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system:
              "You are a helpful cooking assistant watching someone cook. When shown a photo of food cooking in a pan or pot, give a short (1–2 sentence) practical observation: describe what you see and whether it looks on track, needs attention, or is done. If nothing notable has changed and everything looks fine, reply with exactly the word NOCHANGE and nothing else. Be encouraging but honest. No markdown.",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text:
                      contextText +
                      "Please check my pan and tell me how it looks.",
                  },
                  {
                    type: "image_url",
                    image_url: { url },
                  },
                ],
              },
            ],
          }),
        });
        if (!aiRes.ok) throw new Error("AI check failed");
        const { text } = await aiRes.json();

        // NOCHANGE means the auto-loop should stay quiet
        const hasChange = text.trim().toUpperCase() !== "NOCHANGE";

        if (hasChange) {
          setCheckResult(text);
          // Manual taps speak immediately; the auto-loop awaits speakText itself
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
        setCheckError(
          err instanceof Error ? err.message : "Something went wrong"
        );
        return { hasChange: false, text: "" };
      } finally {
        setChecking(false);
      }
    },
    [checking, stepInstruction]
  );

  // ── 60-second auto-check loop ─────────────────────────────────────────
  // Uses setTimeout (not setInterval) so the 60 s window starts AFTER any
  // speech has finished, preventing overlapping announcements.
  useEffect(() => {
    if (!cameraReady) return; // don't start until camera is up

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const loop = () => {
      timeoutId = setTimeout(async () => {
        if (cancelled) return;

        // silent=true so checkPan does not call speechSynthesis itself
        const { hasChange, text } = await checkPan(true);

        // Only speak (and await completion) when something changed
        if (!cancelled && hasChange && text) {
          await speakText(text).catch(() => {/* ignore speech errors */});
        }

        // Schedule the next check only after speech (or the silent check) ends
        if (!cancelled) loop();
      }, 60_000);
    };

    loop();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      window.speechSynthesis?.cancel();
    };
    // checkPan identity changes when `checking` flips, but we want the loop
    // to use whatever checkPan is current at call-time, not at setup-time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraReady]);

  return (
    <div style={overlayStyles.root}>
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Corner video preview */}
      <div style={overlayStyles.videoCorner}>
        {cameraReady ? (
          <video
            ref={videoRef}
            style={overlayStyles.video}
            autoPlay
            playsInline
            muted
          />
        ) : (
          <div style={overlayStyles.videoPlaceholder}>
            {cameraError ? (
              <span style={{ fontSize: 11, color: "#FF6B6B", textAlign: "center", padding: 4 }}>
                {cameraError}
              </span>
            ) : (
              <span style={{ fontSize: 18 }}>📷</span>
            )}
          </div>
        )}

        {/* Elapsed time badge over video corner */}
        <div style={overlayStyles.timerBadge}>{formatTime(elapsedSeconds)}</div>
      </div>

      {/* Action bar at the bottom */}
      <div style={overlayStyles.actionBar}>
        {/* Check My Pan button */}
        <button
          style={{
            ...overlayStyles.checkBtn,
            opacity: checking || !cameraReady ? 0.55 : 1,
          }}
          onClick={checkPan}
          disabled={checking || !cameraReady}
        >
          {checking ? (
            <>
              <span style={overlayStyles.spinner} />
              Checking…
            </>
          ) : (
            <>🍳 Check My Pan</>
          )}
        </button>

        {/* Stop button */}
        <button style={overlayStyles.stopBtn} onClick={onStop}>
          ⏹ Stop
        </button>
      </div>

      {/* AI feedback bubble */}
      {(checkResult || checkError) && (
        <div
          style={{
            ...overlayStyles.feedbackBubble,
            borderColor: checkError ? "#FF6B6B44" : "#FF6B3544",
          }}
        >
          {checkError ? (
            <span style={{ color: "#FF6B6B", fontSize: 13 }}>⚠ {checkError}</span>
          ) : (
            <span style={{ color: "#fff", fontSize: 14, lineHeight: 1.5 }}>
              {checkResult}
            </span>
          )}
          <button
            style={overlayStyles.dismissBtn}
            onClick={() => {
              setCheckResult(null);
              setCheckError("");
            }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

const overlayStyles: Record<string, React.CSSProperties> = {
  root: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    pointerEvents: "none", // let taps pass through the transparent middle
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },

  // ── Corner video ──────────────────────────────────────────────────────
  videoCorner: {
    pointerEvents: "auto",
    position: "relative",
    width: 120,
    height: 90,
    margin: "16px 16px 0 0",
    borderRadius: 12,
    overflow: "hidden",
    border: "2px solid rgba(255,255,255,0.18)",
    background: "#111",
    boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
    flexShrink: 0,
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  videoPlaceholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#1a1a1a",
  },
  timerBadge: {
    position: "absolute",
    bottom: 4,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 11,
    fontWeight: 700,
    color: "#fff",
    background: "rgba(0,0,0,0.55)",
    letterSpacing: 0.5,
    paddingBottom: 2,
  },

  // ── Action bar ────────────────────────────────────────────────────────
  actionBar: {
    pointerEvents: "auto",
    width: "100%",
    display: "flex",
    gap: 10,
    padding: "12px 16px 32px",
    background: "linear-gradient(to top, rgba(0,0,0,0.85) 70%, transparent)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkBtn: {
    flex: 1,
    maxWidth: 220,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "#FF6B35",
    color: "#fff",
    border: "none",
    borderRadius: 16,
    padding: "16px 20px",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: 0.3,
  },
  stopBtn: {
    background: "#1a1a1a",
    color: "#fff",
    border: "1px solid #333",
    borderRadius: 16,
    padding: "16px 20px",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  // ── Spinner (inline) ──────────────────────────────────────────────────
  spinner: {
    display: "inline-block",
    width: 14,
    height: 14,
    border: "2px solid rgba(255,255,255,0.3)",
    borderTop: "2px solid #fff",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },

  // ── Feedback bubble ───────────────────────────────────────────────────
  feedbackBubble: {
    pointerEvents: "auto",
    position: "absolute",
    bottom: 100,
    left: 16,
    right: 16,
    background: "rgba(20,20,20,0.96)",
    border: "1px solid",
    borderRadius: 16,
    padding: "14px 40px 14px 16px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "flex-start",
  },
  dismissBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    background: "transparent",
    border: "none",
    color: "#666",
    fontSize: 14,
    cursor: "pointer",
    lineHeight: 1,
  },
};