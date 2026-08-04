"use client";

import { useRef, useState, useEffect, useCallback } from "react";

type AppState =
  | "loading"
  | "unauthenticated"
  | "home"
  | "camera"
  | "preview"
  | "uploading"
  | "done";

interface User {
  email: string;
}

export default function SousPage() {
  const [appState, setAppState] = useState<AppState>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedSource, setCapturedSource] = useState<"camera" | "library">("camera");
  const [cameraError, setCameraError] = useState("");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check session on mount
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((data) => {
        if (data.email) {
          setUser({ email: data.email });
          setAppState("home");
        } else {
          setAppState("unauthenticated");
        }
      })
      .catch(() => setAppState("unauthenticated"));
  }, []);

  // Stop camera stream when leaving camera state
  useEffect(() => {
    if (appState !== "camera" && streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, [appState]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: authMode, email: authEmail, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Auth failed");
      setUser({ email: authEmail });
      setAppState("home");
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "logout" }),
    });
    setUser(null);
    setAppState("unauthenticated");
  };

  const startCamera = useCallback(async () => {
    setCameraError("");
    setAppState("camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch {
      setCameraError("Camera not available. Please pick a photo from your library instead.");
    }
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        setCapturedImage(url);
        setCapturedBlob(blob);
        setCapturedSource("camera");
        setAppState("preview");
      },
      "image/jpeg",
      0.92
    );
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCapturedImage(url);
    setCapturedBlob(file);
    setCapturedSource("library");
    setAppState("preview");
    // Reset input so the same file can be re-selected
    e.target.value = "";
  }, []);

  const handleUsePhoto = useCallback(async () => {
    if (!capturedBlob || !user) return;
    setAppState("uploading");
    try {
      // Upload to blob storage
      const formData = new FormData();
      formData.append("file", capturedBlob, "sous-photo.jpg");
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { url } = await uploadRes.json();

      // Save to database
      const saveRes = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: url, source: capturedSource }),
      });
      if (!saveRes.ok) throw new Error("Save failed");

      setUploadedUrl(url);
      setAppState("done");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setAppState("preview");
    }
  }, [capturedBlob, capturedSource, user]);

  const resetToHome = useCallback(() => {
    if (capturedImage) URL.revokeObjectURL(capturedImage);
    setCapturedImage(null);
    setCapturedBlob(null);
    setUploadedUrl(null);
    setCameraError("");
    setAppState("home");
  }, [capturedImage]);

  // ── RENDER ─────────────────────────────────────────────────────────────

  if (appState === "loading") {
    return (
      <div style={styles.fullscreen}>
        <div style={styles.spinner} />
        <p style={{ color: "#888", marginTop: 16 }}>Loading…</p>
      </div>
    );
  }

  if (appState === "unauthenticated") {
    return (
      <div style={styles.fullscreen}>
        <div style={styles.authCard}>
          <div style={styles.logo}>🍳</div>
          <h1 style={styles.logoTitle}>Sous</h1>
          <p style={styles.tagline}>Your hands-free kitchen assistant</p>

          <div style={styles.tabRow}>
            <button
              style={{ ...styles.tab, ...(authMode === "login" ? styles.tabActive : {}) }}
              onClick={() => { setAuthMode("login"); setAuthError(""); }}
            >
              Sign in
            </button>
            <button
              style={{ ...styles.tab, ...(authMode === "signup" ? styles.tabActive : {}) }}
              onClick={() => { setAuthMode("signup"); setAuthError(""); }}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleAuth} style={styles.form}>
            <input
              style={styles.input}
              type="email"
              placeholder="Email address"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <input
              style={styles.input}
              type="password"
              placeholder="Password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              required
              autoComplete={authMode === "signup" ? "new-password" : "current-password"}
            />
            {authError && <p style={styles.error}>{authError}</p>}
            <button style={styles.primaryBtn} type="submit" disabled={authLoading}>
              {authLoading ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (appState === "home") {
    return (
      <div style={styles.fullscreen}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerLogo}>🍳 Sous</span>
          <button style={styles.logoutBtn} onClick={handleLogout}>Sign out</button>
        </div>

        {/* Main content */}
        <div style={styles.homeContent}>
          <div style={styles.heroIcon}>📸</div>
          <h2 style={styles.heroTitle}>What's in your kitchen?</h2>
          <p style={styles.heroSub}>
            Take a photo of your ingredients and Sous will tell you what to cook.
          </p>

          <div style={styles.buttonStack}>
            <button style={styles.primaryBtn} onClick={startCamera}>
              📷 Take a photo
            </button>
            <button
              style={styles.secondaryBtn}
              onClick={() => fileInputRef.current?.click()}
            >
              🖼️ Choose from library
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
        </div>

        <p style={styles.footerNote}>Signed in as {user?.email}</p>
      </div>
    );
  }

  if (appState === "camera") {
    return (
      <div style={styles.fullscreen}>
        {/* Camera viewfinder */}
        <div style={styles.cameraContainer}>
          {cameraError ? (
            <div style={styles.cameraError}>
              <span style={{ fontSize: 48 }}>🚫</span>
              <p style={{ marginTop: 12, color: "#fff", textAlign: "center", padding: "0 24px" }}>
                {cameraError}
              </p>
              <button
                style={{ ...styles.secondaryBtn, marginTop: 20 }}
                onClick={() => fileInputRef.current?.click()}
              >
                🖼️ Choose from library
              </button>
              <button style={{ ...styles.ghostBtn, marginTop: 12 }} onClick={resetToHome}>
                ← Back
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFileSelect}
              />
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                style={styles.video}
                autoPlay
                playsInline
                muted
              />
              {/* Canvas used for capture (hidden) */}
              <canvas ref={canvasRef} style={{ display: "none" }} />

              {/* Camera UI overlay */}
              <div style={styles.cameraOverlay}>
                <button style={styles.backBtnOverlay} onClick={resetToHome}>
                  ✕
                </button>

                {/* Viewfinder frame */}
                <div style={styles.viewfinderFrame} />

                {/* Shutter button */}
                <div style={styles.shutterRow}>
                  <button style={styles.shutterBtn} onClick={capturePhoto}>
                    <div style={styles.shutterInner} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (appState === "preview") {
    return (
      <div style={styles.fullscreen}>
        <div style={styles.header}>
          <button style={styles.ghostBtn} onClick={resetToHome}>← Retake</button>
          <span style={{ color: "#fff", fontWeight: 600 }}>Preview</span>
          <div style={{ width: 72 }} />
        </div>

        <div style={styles.previewContainer}>
          {capturedImage && (
            <img
              src={capturedImage}
              alt="Captured ingredients"
              style={styles.previewImage}
            />
          )}
        </div>

        <div style={styles.previewActions}>
          <p style={styles.previewHint}>
            {capturedSource === "camera"
              ? "📷 Taken with camera"
              : "🖼️ Chosen from library"}
          </p>
          <button style={styles.primaryBtn} onClick={handleUsePhoto}>
            ✅ Use this photo
          </button>
          <button style={styles.ghostBtn} onClick={resetToHome}>
            Retake / choose different
          </button>
        </div>
      </div>
    );
  }

  if (appState === "uploading") {
    return (
      <div style={styles.fullscreen}>
        <div style={styles.spinner} />
        <p style={{ color: "#fff", marginTop: 20, fontSize: 18 }}>Saving your photo…</p>
      </div>
    );
  }

  if (appState === "done") {
    return (
      <div style={styles.fullscreen}>
        <div style={styles.doneCard}>
          <div style={{ fontSize: 72 }}>✅</div>
          <h2 style={styles.doneTitle}>Photo saved!</h2>
          {uploadedUrl && (
            <img
              src={uploadedUrl}
              alt="Your photo"
              style={styles.doneImage}
            />
          )}
          <p style={styles.doneSub}>
            Next: Sous will analyse your ingredients and suggest recipes.
          </p>
          <button style={styles.primaryBtn} onClick={resetToHome}>
            📷 Take another photo
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ── STYLES ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  fullscreen: {
    minHeight: "100dvh",
    background: "#111",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    position: "relative",
    overflowX: "hidden",
  },

  // Auth
  authCard: {
    background: "#1a1a1a",
    borderRadius: 24,
    padding: "40px 32px",
    width: "100%",
    maxWidth: 380,
    margin: "0 16px",
    boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  logo: { fontSize: 52 },
  logoTitle: { color: "#fff", fontSize: 32, fontWeight: 800, margin: 0 },
  tagline: { color: "#888", fontSize: 14, margin: "0 0 16px", textAlign: "center" },
  tabRow: { display: "flex", gap: 0, background: "#222", borderRadius: 12, padding: 4, width: "100%" },
  tab: {
    flex: 1,
    padding: "10px 0",
    background: "transparent",
    border: "none",
    color: "#888",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 14,
    transition: "all 0.2s",
  },
  tabActive: { background: "#FF6B35", color: "#fff" },
  form: { display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 8 },
  input: {
    padding: "14px 16px",
    borderRadius: 12,
    border: "1px solid #333",
    background: "#222",
    color: "#fff",
    fontSize: 16,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  error: { color: "#FF6B6B", fontSize: 13, margin: 0 },

  // Header
  header: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    background: "rgba(17,17,17,0.95)",
    backdropFilter: "blur(8px)",
    zIndex: 100,
    borderBottom: "1px solid #222",
  },
  headerLogo: { color: "#fff", fontWeight: 800, fontSize: 20 },
  logoutBtn: {
    background: "transparent",
    border: "1px solid #333",
    color: "#888",
    borderRadius: 8,
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: 13,
  },

  // Home
  homeContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "0 24px",
    marginTop: 80,
    gap: 12,
    width: "100%",
    maxWidth: 440,
  },
  heroIcon: { fontSize: 80, marginBottom: 8 },
  heroTitle: { color: "#fff", fontSize: 28, fontWeight: 800, margin: 0, textAlign: "center" },
  heroSub: { color: "#888", fontSize: 16, textAlign: "center", margin: "0 0 16px", lineHeight: 1.5 },
  buttonStack: { display: "flex", flexDirection: "column", gap: 12, width: "100%" },
  footerNote: {
    position: "fixed",
    bottom: 16,
    color: "#444",
    fontSize: 12,
  },

  // Buttons
  primaryBtn: {
    background: "#FF6B35",
    color: "#fff",
    border: "none",
    borderRadius: 16,
    padding: "18px 24px",
    fontSize: 17,
    fontWeight: 700,
    cursor: "pointer",
    width: "100%",
    letterSpacing: 0.3,
    transition: "opacity 0.2s",
  },
  secondaryBtn: {
    background: "#222",
    color: "#fff",
    border: "1px solid #444",
    borderRadius: 16,
    padding: "18px 24px",
    fontSize: 17,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
    transition: "opacity 0.2s",
  },
  ghostBtn: {
    background: "transparent",
    color: "#888",
    border: "none",
    borderRadius: 12,
    padding: "12px 24px",
    fontSize: 15,
    cursor: "pointer",
    width: "100%",
    textAlign: "center",
  },

  // Camera
  cameraContainer: {
    position: "fixed",
    inset: 0,
    background: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  cameraOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "24px 0 48px",
  },
  backBtnOverlay: {
    alignSelf: "flex-start",
    marginLeft: 20,
    background: "rgba(0,0,0,0.5)",
    color: "#fff",
    border: "none",
    borderRadius: "50%",
    width: 44,
    height: 44,
    fontSize: 20,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  viewfinderFrame: {
    width: "75%",
    aspectRatio: "4/3",
    border: "2px solid rgba(255,255,255,0.5)",
    borderRadius: 16,
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.3)",
  },
  shutterRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterBtn: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    background: "rgba(255,255,255,0.2)",
    border: "4px solid #fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: "50%",
    background: "#fff",
  },
  cameraError: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    width: "100%",
    maxWidth: 360,
  },

  // Preview
  previewContainer: {
    flex: 1,
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 70,
    padding: "12px 0",
    background: "#000",
    minHeight: 0,
  },
  previewImage: {
    width: "100%",
    height: "calc(100dvh - 220px)",
    objectFit: "contain",
    display: "block",
  },
  previewActions: {
    width: "100%",
    maxWidth: 440,
    padding: "16px 24px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: "#111",
    alignItems: "center",
  },
  previewHint: {
    color: "#888",
    fontSize: 13,
    margin: 0,
  },

  // Uploading spinner
  spinner: {
    width: 48,
    height: 48,
    border: "4px solid #333",
    borderTop: "4px solid #FF6B35",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },

  // Done
  doneCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
    padding: "32px 24px",
    width: "100%",
    maxWidth: 440,
  },
  doneTitle: { color: "#fff", fontSize: 28, fontWeight: 800, margin: 0 },
  doneImage: {
    width: "100%",
    maxHeight: 300,
    objectFit: "cover",
    borderRadius: 20,
    border: "2px solid #333",
  },
  doneSub: {
    color: "#888",
    textAlign: "center",
    fontSize: 15,
    margin: 0,
    lineHeight: 1.5,
  },
};