"use client";

import { useRef, useState, useCallback, useEffect } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export type WatchSessionStatus =
  | "idle"
  | "starting"
  | "active"
  | "stopping"
  | "error";

export interface WatchCheckResult {
  ready: boolean;
  observation: string;
  encouragement: string;
}

export interface WatchSession {
  status: WatchSessionStatus;
  /** Current recipe step index (0-based) the session is watching */
  stepIndex: number;
  /** Most recent AI check result, null if none yet */
  lastCheck: WatchCheckResult | null;
  /** Whether an AI check is currently in-flight */
  checking: boolean;
  /** Human-readable error message, null when no error */
  error: string | null;
  /** Whether the camera stream is live */
  streaming: boolean;
}

export interface UseWatchMeCookReturn {
  session: WatchSession;
  videoRef: React.RefObject<HTMLVideoElement>;
  /** Start a watch session for the given step index */
  startSession: (stepIndex: number) => Promise<void>;
  /** Stop the session and release the camera */
  stopSession: () => void;
  /** Advance the watched step index (call after the user moves to the next step) */
  setWatchStep: (stepIndex: number) => void;
  /** Capture a frame and ask the AI to assess progress against the given instruction */
  triggerManualCheck: (stepInstruction: string) => Promise<WatchCheckResult | null>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWatchMeCook(): UseWatchMeCookReturn {
  const [status, setStatus] = useState<WatchSessionStatus>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [lastCheck, setLastCheck] = useState<WatchCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Track whether a stop was requested so async callbacks can bail out
  const stoppedRef = useRef(false);

  // Lazily create an off-screen canvas for frame capture
  const getCanvas = useCallback((): HTMLCanvasElement => {
    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement("canvas");
    }
    return captureCanvasRef.current;
  }, []);

  // ── Camera management ─────────────────────────────────────────────────────

  const startStream = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Wait for the video to be playable
        await new Promise<void>((resolve, reject) => {
          const vid = videoRef.current!;
          vid.oncanplay = () => resolve();
          vid.onerror = () => reject(new Error("Video element error"));
          vid.play().catch(reject);
        });
      }

      setStreaming(true);
      return true;
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Camera unavailable";
      setError(
        "Could not access the camera. Please allow camera permission and try again. (" +
          msg +
          ")"
      );
      return false;
    }
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreaming(false);
  }, []);

  // ── Frame capture ─────────────────────────────────────────────────────────

  /**
   * Capture the current video frame and upload it, returning the blob URL
   * that can be sent to the AI vision endpoint.
   */
  const captureAndUpload = useCallback(async (): Promise<string | null> => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;

    const canvas = getCanvas();
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise<string | null>((resolve) => {
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          try {
            const formData = new FormData();
            formData.append("file", blob, "watch-frame.jpg");
            const res = await fetch("/api/upload", {
              method: "POST",
              body: formData,
            });
            if (!res.ok) {
              resolve(null);
              return;
            }
            const { url } = await res.json();
            resolve(url as string);
          } catch {
            resolve(null);
          }
        },
        "image/jpeg",
        0.82
      );
    });
  }, [getCanvas]);

  // ── AI check ─────────────────────────────────────────────────────────────

  const triggerManualCheck = useCallback(
    async (stepInstruction: string): Promise<WatchCheckResult | null> => {
      if (status !== "active" || checking || stoppedRef.current) return null;

      setChecking(true);
      try {
        const imageUrl = await captureAndUpload();
        if (!imageUrl || stoppedRef.current) {
          setChecking(false);
          return null;
        }

        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system: `You are a helpful cooking assistant watching someone cook via their camera.
Your job is to assess whether the cook looks ready to move on to the next step.
Respond with ONLY a JSON object with exactly these fields:
{
  "ready": boolean,
  "observation": string (one short sentence describing what you see),
  "encouragement": string (one short encouraging sentence, e.g. "Looking great!" or "Almost there!")
}
No markdown, no explanation — just the raw JSON object.`,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `The cook is on this step: "${stepInstruction}". Can you see that they have completed it or are ready to move on?`,
                  },
                  {
                    type: "image_url",
                    image_url: { url: imageUrl },
                  },
                ],
              },
            ],
          }),
        });

        if (!res.ok || stoppedRef.current) {
          setChecking(false);
          return null;
        }

        const { text } = await res.json();

        let result: WatchCheckResult | null = null;
        try {
          const cleaned = text.replace(/```[a-z]*\n?/gi, "").trim();
          result = JSON.parse(cleaned);
        } catch {
          // Best-effort fallback
          result = {
            ready: false,
            observation: "Could not read the AI response.",
            encouragement: "Keep going!",
          };
        }

        if (!stoppedRef.current && result) {
          setLastCheck(result);
        }

        setChecking(false);
        return result;
      } catch {
        setChecking(false);
        return null;
      }
    },
    [status, checking, captureAndUpload]
  );

  // ── Public API ────────────────────────────────────────────────────────────

  const startSession = useCallback(
    async (initialStepIndex: number) => {
      if (status === "active" || status === "starting") return;

      stoppedRef.current = false;
      setError(null);
      setLastCheck(null);
      setChecking(false);
      setStepIndex(initialStepIndex);
      setStatus("starting");

      const ok = await startStream();
      if (stoppedRef.current) {
        // stopSession was called while we were waiting for the camera
        stopStream();
        setStatus("idle");
        return;
      }
      if (!ok) {
        setStatus("error");
        return;
      }
      setStatus("active");
    },
    [status, startStream, stopStream]
  );

  const stopSession = useCallback(() => {
    stoppedRef.current = true;
    setStatus("stopping");
    stopStream();
    setLastCheck(null);
    setChecking(false);
    setError(null);
    setStatus("idle");
  }, [stopStream]);

  const setWatchStep = useCallback((idx: number) => {
    setStepIndex(idx);
    // Clear the last check result so the UI doesn't show stale feedback
    setLastCheck(null);
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // ── Composed session object ───────────────────────────────────────────────

  const session: WatchSession = {
    status,
    stepIndex,
    lastCheck,
    checking,
    error,
    streaming,
  };

  return {
    session,
    videoRef,
    startSession,
    stopSession,
    setWatchStep,
    triggerManualCheck,
  };
}