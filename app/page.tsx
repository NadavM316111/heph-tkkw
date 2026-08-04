"use client";

import { useRef, useState, useEffect, useCallback } from "react";

type AppState =
  | "loading"
  | "unauthenticated"
  | "home"
  | "camera"
  | "preview"
  | "uploading"
  | "analysing"
  | "ingredients"
  | "finding_recipes"
  | "recipes"
  | "cooking"
  | "done";

interface User {
  email: string;
}

interface RecipeStep {
  step_number: number;
  instruction: string;
}

interface Recipe {
  title: string;
  description: string;
  total_time_minutes: number;
  difficulty: string;
  ingredients_used: string[];
  extra_ingredients_needed: string[];
  steps: RecipeStep[];
  source_inspiration?: string;
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
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [newIngredient, setNewIngredient] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [activeRecipe, setActiveRecipe] = useState<Recipe | null>(null);
  const [cookingStep, setCookingStep] = useState(0);
  const [listeningForNext, setListeningForNext] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [recipeError, setRecipeError] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  // ── Parse a step instruction for a duration (returns seconds, or 0) ────────
  const parseStepDuration = useCallback((instruction: string): number => {
    // Matches patterns like: "5 minutes", "1 minute", "30 seconds", "1 hour 30 minutes"
    const text = instruction.toLowerCase();
    let totalSeconds = 0;

    const hourMatch   = text.match(/(\d+(?:\.\d+)?)\s*hour/);
    const minMatch    = text.match(/(\d+(?:\.\d+)?)\s*min/);
    const secMatch    = text.match(/(\d+(?:\.\d+)?)\s*sec/);

    if (hourMatch) totalSeconds += parseFloat(hourMatch[1]) * 3600;
    if (minMatch)  totalSeconds += parseFloat(minMatch[1])  * 60;
    if (secMatch)  totalSeconds += parseFloat(secMatch[1]);

    // Only start a timer if the instruction implies an action with duration
    // (e.g. "cook for", "simmer for", "bake for", "wait", "let rest", "heat for")
    const actionWords = /cook|simmer|bake|roast|fry|boil|steam|heat|wait|rest|let|marinate|chill|refrigerat|whisk|stir|knead|soak|reduce/;
    if (totalSeconds > 0 && actionWords.test(text)) {
      return Math.round(totalSeconds);
    }
    return 0;
  }, []);

  // ── Clear any running step timer ───────────────────────────────────────────
  const clearStepTimer = useCallback(() => {
    if (stepTimerRef.current) {
      clearInterval(stepTimerRef.current);
      stepTimerRef.current = null;
    }
    setStepTimerTotal(0);
    setStepTimerLeft(0);
    setStepTimerDone(false);
  }, []);

  // ── Start a countdown for `seconds` ───────────────────────────────────────
  const startStepTimer = useCallback((seconds: number, onDone: () => void) => {
    clearStepTimer();
    setStepTimerTotal(seconds);
    setStepTimerLeft(seconds);
    setStepTimerDone(false);

    stepTimerRef.current = setInterval(() => {
      setStepTimerLeft((prev) => {
        if (prev <= 1) {
          clearInterval(stepTimerRef.current!);
          stepTimerRef.current = null;
          setStepTimerDone(true);
          onDone();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearStepTimer]);
  const synthStopRef = useRef(false);

  // Detect speech support on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasSynth = "speechSynthesis" in window;
      const hasRecog = !!(
        (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
      );
      setSpeechSupported(hasSynth && hasRecog);
    }
  }, []);

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

  // Speak + listen cycle when cooking step changes
  useEffect(() => {
    if (appState !== "cooking" || !activeRecipe) return;

    const steps = activeRecipe.steps;
    const current = steps[cookingStep];
    if (!current) return;

    synthStopRef.current = false;

    // Stop any ongoing recognition before speaking
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setListeningForNext(false);

    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();

    const prefix = cookingStep === steps.length - 1
      ? `Final step. `
      : `Step ${current.step_number} of ${steps.length}. `;

    const utt = new SpeechSynthesisUtterance(prefix + current.instruction);
    utt.rate = 0.95;
    utt.pitch = 1;
    utt.lang = "en-US";

    utt.onend = () => {
      if (synthStopRef.current) return;
      startListening();
    };

    window.speechSynthesis.speak(utt);

    return () => {
      synthStopRef.current = true;
      window.speechSynthesis.cancel();
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      setListeningForNext(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState, cookingStep, activeRecipe]);

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

      // Ask AI to identify ingredients in the photo
      setAppState("analysing");
      const aiRes = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system:
            "You are a kitchen assistant. When shown a photo of food or ingredients, respond with ONLY a JSON array of ingredient name strings — no explanation, no markdown, just the raw JSON array. Example: [\"eggs\",\"butter\",\"flour\"]",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "List every ingredient or food item you can see in this photo.",
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
      if (!aiRes.ok) throw new Error("AI analysis failed");
      const { text } = await aiRes.json();

      let detected: string[] = [];
      try {
        // Strip markdown code fences if the model wrapped the JSON
        const cleaned = text.replace(/```[a-z]*\n?/gi, "").trim();
        detected = JSON.parse(cleaned);
        if (!Array.isArray(detected)) detected = [];
      } catch {
        // If parsing fails, try to extract quoted words as a fallback
        detected = (text.match(/"([^"]+)"/g) || []).map((s: string) =>
          s.replace(/"/g, "")
        );
      }

      setIngredients(detected.filter((i) => typeof i === "string" && i.trim()));
      setAppState("ingredients");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setAppState("preview");
    }
  }, [capturedBlob, capturedSource, user]);

  const speakText = useCallback((text: string, onDone?: () => void) => {
    if (!("speechSynthesis" in window)) {
      onDone?.();
      return;
    }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.95;
    utt.pitch = 1;
    utt.lang = "en-US";
    utt.onend = () => onDone?.();
    window.speechSynthesis.speak(utt);
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) return;

    setListeningForNext(true);
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      const transcript: string = event.results[0][0].transcript.toLowerCase().trim();

      if (transcript.includes("next") || transcript.includes("continue") || transcript.includes("ok") || transcript.includes("go")) {
        setListeningForNext(false);
        recognitionRef.current = null;
        setCookingStep((prev) => {
          if (activeRecipe && prev < activeRecipe.steps.length - 1) return prev + 1;
          return prev;
        });

      } else if (transcript.includes("repeat") || transcript.includes("again")) {
        // Re-read the current step by stopping synth then restarting the effect
        setListeningForNext(false);
        recognitionRef.current = null;
        window.speechSynthesis.cancel();
        // Trigger the cooking effect again by momentarily flipping a signal —
        // we do this by reading the current step instruction directly and speaking it.
        setCookingStep((prev) => {
          // speak after state settles
          setTimeout(() => {
            if (activeRecipe) {
              const current = activeRecipe.steps[prev];
              const prefix = prev === activeRecipe.steps.length - 1
                ? "Final step. "
                : `Step ${current.step_number} of ${activeRecipe.steps.length}. `;
              speakText(prefix + current.instruction, () => {
                if (!synthStopRef.current) startListening();
              });
            }
          }, 100);
          return prev;
        });

      } else if (transcript.includes("back") || transcript.includes("previous")) {
        setListeningForNext(false);
        recognitionRef.current = null;
        synthStopRef.current = true;
        window.speechSynthesis.cancel();
        synthStopRef.current = false;
        setCookingStep((prev) => Math.max(0, prev - 1));

      } else if (transcript.includes("ingredient")) {
        setListeningForNext(false);
        recognitionRef.current = null;
        window.speechSynthesis.cancel();
        if (activeRecipe) {
          const used = activeRecipe.ingredients_used ?? [];
          const extra = activeRecipe.extra_ingredients_needed ?? [];
          const all = [...used, ...extra];
          const text = all.length > 0
            ? "Ingredients: " + all.join(", ") + "."
            : "No ingredient list available.";
          speakText(text, () => {
            if (!synthStopRef.current) startListening();
          });
        }

      } else {
        // Didn't hear a recognised command — listen again
        recognition.stop();
        recognitionRef.current = null;
        setTimeout(() => { if (!synthStopRef.current) startListening(); }, 400);
      }
    };

    recognition.onerror = () => {
      setListeningForNext(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      // If still expecting input and wasn't stopped intentionally, re-listen
      setListeningForNext((prev) => {
        if (prev && !synthStopRef.current) {
          setTimeout(startListening, 400);
        }
        return false;
      });
      recognitionRef.current = null;
    };

    recognition.start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRecipe, speakText]);

  const advanceCookingStep = useCallback(() => {
    if (!activeRecipe) return;
    if (cookingStep < activeRecipe.steps.length - 1) {
      // stop current speech/listening first
      synthStopRef.current = true;
      window.speechSynthesis.cancel();
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      setListeningForNext(false);
      synthStopRef.current = false;
      setCookingStep((p) => p + 1);
    }
  }, [activeRecipe, cookingStep]);

  const startCooking = useCallback((recipe: Recipe) => {
    setActiveRecipe(recipe);
    setCookingStep(0);
    setAppState("cooking");
  }, []);

  const stopCooking = useCallback(() => {
    synthStopRef.current = true;
    window.speechSynthesis.cancel();
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setListeningForNext(false);
    setActiveRecipe(null);
    setCookingStep(0);
    setAppState("recipes");
  }, []);

  const findRecipes = useCallback(async () => {
    if (ingredients.length === 0) return;
    setRecipeError("");
    setAppState("finding_recipes");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: `You are a world-class chef with encyclopaedic knowledge of real, named recipes from cookbooks, food websites (BBC Good Food, Serious Eats, NYT Cooking, AllRecipes, Bon Appétit, etc.), and culinary traditions worldwide.

Given a list of ingredients, suggest 3 REAL, SPECIFIC, NAMED recipes a home cook could actually make — dishes people would genuinely search for online. Prefer well-known classics or popular modern recipes over generic inventions. If the ingredients strongly suggest a particular cuisine or dish, lean into that.

Respond with ONLY a JSON array — no markdown, no explanation. Each recipe object must have exactly these fields:
{
  "title": string (the real, specific dish name, e.g. "Spaghetti Carbonara" not "Pasta Dish"),
  "description": string (1-2 sentences describing the dish and why it works with these ingredients),
  "total_time_minutes": number,
  "difficulty": "easy"|"medium"|"hard",
  "ingredients_used": string[] (from the user's list),
  "extra_ingredients_needed": string[] (common pantry items or extras needed),
  "source_inspiration": string (e.g. "Classic Roman recipe", "BBC Good Food favourite", "Serious Eats method", "Traditional Thai street food"),
  "steps": [{ "step_number": number, "instruction": string }]
}

Steps must be detailed, practical, kitchen-tested instructions a home cook can follow confidently. Aim for 6-10 steps. Include temperatures, timings, and visual cues (e.g. "cook until golden brown, about 3 minutes").`,
          messages: [
            {
              role: "user",
              content: `I have these ingredients available: ${ingredients.join(", ")}.

Search your knowledge of real recipes from cookbooks and food websites. Give me 3 specific, named dishes I can actually make — ideally ones I could look up online to verify. Prioritise recipes that use most of my ingredients well.`,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error("AI request failed");
      const { text } = await res.json();
      let parsed: Recipe[] = [];
      try {
        const cleaned = text.replace(/```[a-z]*\n?/gi, "").trim();
        parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) parsed = [];
      } catch {
        const match = text.match(/\[[\s\S]*\]/);
        if (match) parsed = JSON.parse(match[0]);
      }
      setRecipes(parsed.filter((r) => r && r.title && Array.isArray(r.steps)));
      setAppState("recipes");
    } catch (err: unknown) {
      setRecipeError(err instanceof Error ? err.message : "Failed to find recipes");
      setAppState("ingredients");
    }
  }, [ingredients]);

  const resetToHome = useCallback(() => {
    if (capturedImage) URL.revokeObjectURL(capturedImage);
    setCapturedImage(null);
    setCapturedBlob(null);
    setUploadedUrl(null);
    setCameraError("");
    setIngredients([]);
    setNewIngredient("");
    setEditingIndex(null);
    setEditingValue("");
    setRecipes([]);
    setActiveRecipe(null);
    setCookingStep(0);
    setRecipeError("");
    synthStopRef.current = true;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setListeningForNext(false);
    setAppState("home");
  }, [capturedImage]);

  const removeIngredient = useCallback((index: number) => {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const startEditing = useCallback((index: number, value: string) => {
    setEditingIndex(index);
    setEditingValue(value);
  }, []);

  const commitEdit = useCallback(() => {
    if (editingIndex === null) return;
    const trimmed = editingValue.trim();
    if (trimmed) {
      setIngredients((prev) =>
        prev.map((item, i) => (i === editingIndex ? trimmed : item))
      );
    } else {
      setIngredients((prev) => prev.filter((_, i) => i !== editingIndex));
    }
    setEditingIndex(null);
    setEditingValue("");
  }, [editingIndex, editingValue]);

  const addIngredient = useCallback(() => {
    const trimmed = newIngredient.trim();
    if (!trimmed) return;
    setIngredients((prev) => [...prev, trimmed]);
    setNewIngredient("");
  }, [newIngredient]);

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

  if (appState === "analysing") {
    return (
      <div style={styles.fullscreen}>
        <div style={styles.spinner} />
        <p style={{ color: "#fff", marginTop: 20, fontSize: 18 }}>Identifying ingredients…</p>
        <p style={{ color: "#666", marginTop: 8, fontSize: 14 }}>AI is looking at your photo</p>
      </div>
    );
  }

  if (appState === "ingredients") {
    return (
      <div style={styles.fullscreen}>
        <div style={styles.header}>
          <button style={styles.ghostBtn} onClick={resetToHome}>← Start over</button>
          <span style={{ color: "#fff", fontWeight: 600 }}>Ingredients</span>
          <div style={{ width: 90 }} />
        </div>

        <div style={styles.ingredientsContent}>
          {uploadedUrl && (
            <img src={uploadedUrl} alt="Your ingredients" style={styles.thumbImage} />
          )}

          <h2 style={styles.sectionTitle}>
            {ingredients.length > 0
              ? `Found ${ingredients.length} ingredient${ingredients.length !== 1 ? "s" : ""}`
              : "No ingredients detected"}
          </h2>
          <p style={styles.sectionSub}>
            Tap any item to edit it, or swipe the ✕ to remove. Add anything the AI missed below.
          </p>

          <ul style={styles.ingredientList}>
            {ingredients.map((item, i) => (
              <li key={i} style={styles.ingredientItem}>
                {editingIndex === i ? (
                  <input
                    style={styles.inlineInput}
                    value={editingValue}
                    autoFocus
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") {
                        setEditingIndex(null);
                        setEditingValue("");
                      }
                    }}
                  />
                ) : (
                  <span
                    style={styles.ingredientLabel}
                    onClick={() => startEditing(i, item)}
                  >
                    {item}
                  </span>
                )}
                <button
                  style={styles.removeBtn}
                  onClick={() => removeIngredient(i)}
                  aria-label={`Remove ${item}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          {/* Add missing ingredient */}
          <div style={styles.addRow}>
            <input
              style={styles.addInput}
              type="text"
              placeholder="Add a missed ingredient…"
              value={newIngredient}
              onChange={(e) => setNewIngredient(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addIngredient();
              }}
            />
            <button
              style={styles.addBtn}
              onClick={addIngredient}
              disabled={!newIngredient.trim()}
            >
              + Add
            </button>
          </div>

          {recipeError && <p style={styles.error}>{recipeError}</p>}
          <button
            style={{ ...styles.primaryBtn, marginTop: 8 }}
            onClick={findRecipes}
            disabled={ingredients.length === 0}
          >
            🍽️ Find recipes →
          </button>
          <button style={styles.ghostBtn} onClick={resetToHome}>
            Start over
          </button>
        </div>
      </div>
    );
  }

  if (appState === "finding_recipes") {
    return (
      <div style={styles.fullscreen}>
        <div style={styles.spinner} />
        <p style={{ color: "#fff", marginTop: 20, fontSize: 18 }}>Finding recipes…</p>
        <p style={{ color: "#666", marginTop: 8, fontSize: 14 }}>AI chef is thinking</p>
      </div>
    );
  }

  if (appState === "recipes") {
    return (
      <div style={styles.fullscreen}>
        <div style={styles.header}>
          <button style={styles.ghostBtn} onClick={() => setAppState("ingredients")}>← Back</button>
          <span style={{ color: "#fff", fontWeight: 600 }}>Recipes</span>
          <div style={{ width: 72 }} />
        </div>

        <div style={styles.recipesContent}>
          <h2 style={styles.sectionTitle}>What you can cook</h2>
          <p style={styles.sectionSub}>Tap a recipe to start cooking with voice guidance.</p>

          {recipes.map((recipe, i) => (
            <button
              key={i}
              style={styles.recipeCard}
              onClick={() => startCooking(recipe)}
            >
              <div style={styles.recipeCardHeader}>
                <span style={styles.recipeTitle}>{recipe.title}</span>
                <span style={styles.recipeBadge}>{recipe.difficulty}</span>
              </div>
              <p style={styles.recipeDesc}>{recipe.description}</p>
              {recipe.source_inspiration && (
                <p style={styles.recipeSource}>🔗 {recipe.source_inspiration}</p>
              )}
              <div style={styles.recipeMeta}>
                <span>⏱ {recipe.total_time_minutes} min</span>
                <span>📋 {recipe.steps.length} steps</span>
                {(recipe.extra_ingredients_needed?.length ?? 0) > 0 && (
                  <span style={{ color: "#FF6B6B" }}>
                    +{recipe.extra_ingredients_needed.length} extra needed
                  </span>
                )}
              </div>
            </button>
          ))}

          <button style={{ ...styles.ghostBtn, marginTop: 8 }} onClick={resetToHome}>
            📷 Start over
          </button>
        </div>
      </div>
    );
  }

  if (appState === "cooking") {
    if (!activeRecipe) return null;
    const steps = activeRecipe.steps;
    const current = steps[cookingStep];
    const isLast = cookingStep === steps.length - 1;
    const progress = ((cookingStep + 1) / steps.length) * 100;

    return (
      <div style={styles.cookingScreen}>
        {/* Top bar */}
        <div style={styles.cookingHeader}>
          <button style={styles.cookingBackBtn} onClick={stopCooking}>✕</button>
          <span style={styles.cookingRecipeTitle} title={activeRecipe.title}>
            {activeRecipe.title}
          </span>
          <span style={styles.cookingStepCount}>
            {cookingStep + 1}/{steps.length}
          </span>
        </div>

        {/* Progress bar */}
        <div style={styles.progressBarTrack}>
          <div style={{ ...styles.progressBarFill, width: `${progress}%` }} />
        </div>

        {/* Step content */}
        <div style={styles.cookingBody}>
          <div style={styles.stepNumberBadge}>
            Step {current.step_number}
          </div>

          <p style={styles.stepInstruction}>{current.instruction}</p>

          {/* Listening indicator */}
          {listeningForNext && (
            <div style={styles.listeningBadge}>
              <span style={styles.listeningDot} />
              Listening…
            </div>
          )}

          {!listeningForNext && (
            <p style={styles.speechHint}>
              {speechSupported
                ? `Tap the button below, or use a voice command`
                : "Tap the button below to advance"}
            </p>
          )}

          {/* Voice command pills */}
          {speechSupported && (
            <div style={styles.voiceCommandRow}>
              {[
                { label: "▶ next", hint: "advance" },
                { label: "↺ repeat", hint: "re-read step" },
                { label: "← back", hint: "previous step" },
                { label: "🥕 ingredients", hint: "hear ingredient list" },
              ].map((cmd) => (
                <div key={cmd.label} style={{
                  ...styles.voiceCommandPill,
                  ...(listeningForNext ? styles.voiceCommandPillActive : {}),
                }}>
                  <span style={styles.voiceCommandLabel}>{cmd.label}</span>
                  <span style={styles.voiceCommandHint}>{cmd.hint}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom controls */}
        <div style={styles.cookingFooter}>
          {cookingStep > 0 && (
            <button
              style={styles.prevStepBtn}
              onClick={() => {
                synthStopRef.current = true;
                window.speechSynthesis.cancel();
                if (recognitionRef.current) {
                  try { recognitionRef.current.stop(); } catch {}
                  recognitionRef.current = null;
                }
                setListeningForNext(false);
                synthStopRef.current = false;
                setCookingStep((p) => Math.max(0, p - 1));
              }}
            >
              ← Prev
            </button>
          )}

          {!isLast ? (
            <button style={styles.nextStepBtn} onClick={advanceCookingStep}>
              Next step →
            </button>
          ) : (
            <button
              style={{ ...styles.nextStepBtn, background: "#22c55e" }}
              onClick={() => {
                synthStopRef.current = true;
                window.speechSynthesis.cancel();
                if (recognitionRef.current) {
                  try { recognitionRef.current.stop(); } catch {}
                  recognitionRef.current = null;
                }
                setListeningForNext(false);
                setAppState("done");
              }}
            >
              🎉 Done!
            </button>
          )}
        </div>
      </div>
    );
  }

  if (appState === "done") {
    return (
      <div style={styles.fullscreen}>
        <div style={styles.doneCard}>
          <div style={{ fontSize: 72 }}>🎉</div>
          <h2 style={styles.doneTitle}>
            {activeRecipe ? `You made ${activeRecipe.title}!` : "Enjoy your meal!"}
          </h2>
          <p style={styles.doneSub}>
            Great cooking! Ready to make something else?
          </p>
          {recipes.length > 0 && (
            <button
              style={{ ...styles.secondaryBtn, marginBottom: 8 }}
              onClick={() => setAppState("recipes")}
            >
              ← Back to recipes
            </button>
          )}
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

  // Ingredients screen
  ingredientsContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    padding: "80px 20px 32px",
    width: "100%",
    maxWidth: 500,
    gap: 12,
    overflowY: "auto" as const,
    maxHeight: "100dvh",
  },
  thumbImage: {
    width: "100%",
    maxHeight: 180,
    objectFit: "cover",
    borderRadius: 16,
    border: "1px solid #333",
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: 800,
    margin: "4px 0 0",
  },
  sectionSub: {
    color: "#666",
    fontSize: 13,
    margin: 0,
    lineHeight: 1.5,
  },
  ingredientList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  ingredientItem: {
    display: "flex",
    alignItems: "center",
    background: "#1e1e1e",
    borderRadius: 12,
    padding: "10px 12px",
    gap: 8,
  },
  ingredientLabel: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
    cursor: "pointer",
    padding: "2px 0",
  },
  inlineInput: {
    flex: 1,
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #FF6B35",
    color: "#fff",
    fontSize: 16,
    outline: "none",
    padding: "2px 4px",
  },
  removeBtn: {
    background: "transparent",
    border: "none",
    color: "#555",
    fontSize: 16,
    cursor: "pointer",
    padding: "4px 6px",
    lineHeight: 1,
    flexShrink: 0,
  },
  addRow: {
    display: "flex",
    gap: 8,
    marginTop: 4,
  },
  addInput: {
    flex: 1,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #333",
    background: "#1e1e1e",
    color: "#fff",
    fontSize: 15,
    outline: "none",
  },
  addBtn: {
    background: "#FF6B35",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    padding: "12px 16px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },

  // Recipes list
  recipesContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    padding: "80px 20px 32px",
    width: "100%",
    maxWidth: 500,
    gap: 14,
    overflowY: "auto" as const,
    maxHeight: "100dvh",
  },
  recipeCard: {
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: 20,
    padding: "20px 20px 16px",
    textAlign: "left" as const,
    cursor: "pointer",
    color: "#fff",
    width: "100%",
    transition: "border-color 0.2s, background 0.2s",
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  recipeCardHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  recipeTitle: {
    fontSize: 18,
    fontWeight: 800,
    color: "#fff",
    lineHeight: 1.3,
    flex: 1,
  },
  recipeBadge: {
    background: "#FF6B35",
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    padding: "3px 10px",
    borderRadius: 20,
    whiteSpace: "nowrap" as const,
    textTransform: "capitalize" as const,
    flexShrink: 0,
  },
  recipeDesc: {
    color: "#aaa",
    fontSize: 14,
    margin: 0,
    lineHeight: 1.5,
  },
  recipeSource: {
    color: "#FF6B35",
    fontSize: 12,
    fontWeight: 600,
    margin: 0,
    opacity: 0.85,
  },
  recipeMeta: {
    display: "flex",
    gap: 14,
    color: "#666",
    fontSize: 13,
    flexWrap: "wrap" as const,
  },

  // Cooking screen
  cookingScreen: {
    minHeight: "100dvh",
    background: "#0a0a0a",
    display: "flex",
    flexDirection: "column" as const,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    overflowX: "hidden" as const,
  },
  cookingHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px 12px",
    background: "rgba(10,10,10,0.98)",
    borderBottom: "1px solid #1a1a1a",
    position: "sticky" as const,
    top: 0,
    zIndex: 10,
  },
  cookingBackBtn: {
    background: "#1a1a1a",
    color: "#888",
    border: "none",
    borderRadius: "50%",
    width: 38,
    height: 38,
    fontSize: 18,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cookingRecipeTitle: {
    color: "#fff",
    fontWeight: 700,
    fontSize: 15,
    flex: 1,
    textAlign: "center" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    padding: "0 12px",
  },
  cookingStepCount: {
    color: "#666",
    fontSize: 14,
    fontWeight: 600,
    flexShrink: 0,
    minWidth: 38,
    textAlign: "right" as const,
  },
  progressBarTrack: {
    height: 4,
    background: "#1a1a1a",
    width: "100%",
  },
  progressBarFill: {
    height: "100%",
    background: "#FF6B35",
    transition: "width 0.4s ease",
  },
  cookingBody: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 32px",
    gap: 28,
    minHeight: 0,
  },
  stepNumberBadge: {
    background: "#FF6B35",
    color: "#fff",
    borderRadius: 50,
    padding: "6px 20px",
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
  },
  stepInstruction: {
    color: "#fff",
    fontSize: 26,
    fontWeight: 700,
    textAlign: "center" as const,
    lineHeight: 1.4,
    margin: 0,
    maxWidth: 480,
  },
  listeningBadge: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#1a2a1a",
    border: "1px solid #22c55e44",
    borderRadius: 50,
    padding: "10px 20px",
    color: "#86efac",
    fontSize: 15,
    fontWeight: 600,
  },
  listeningDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#22c55e",
    display: "inline-block",
    boxShadow: "0 0 0 3px #22c55e44",
    animation: "pulse 1.2s ease-in-out infinite",
  },
  speechHint: {
    color: "#444",
    fontSize: 13,
    textAlign: "center" as const,
    margin: 0,
    lineHeight: 1.5,
  },
  voiceCommandRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
    justifyContent: "center",
    maxWidth: 480,
  },
  voiceCommandPill: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    background: "#141414",
    border: "1px solid #2a2a2a",
    borderRadius: 12,
    padding: "8px 14px",
    minWidth: 80,
    transition: "border-color 0.2s, background 0.2s",
  },
  voiceCommandPillActive: {
    border: "1px solid #22c55e44",
    background: "#0f1f0f",
  },
  voiceCommandLabel: {
    color: "#ccc",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 0.2,
  },
  voiceCommandHint: {
    color: "#555",
    fontSize: 11,
    marginTop: 2,
  },
  cookingFooter: {
    padding: "20px 24px 40px",
    display: "flex",
    gap: 12,
    justifyContent: "center",
  },
  nextStepBtn: {
    flex: 1,
    background: "#FF6B35",
    color: "#fff",
    border: "none",
    borderRadius: 20,
    padding: "20px 28px",
    fontSize: 19,
    fontWeight: 800,
    cursor: "pointer",
    maxWidth: 320,
    letterSpacing: 0.3,
  },
  prevStepBtn: {
    background: "#1a1a1a",
    color: "#888",
    border: "1px solid #333",
    borderRadius: 20,
    padding: "20px 20px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
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
    maxHeight: 200,
    objectFit: "cover",
    borderRadius: 20,
    border: "2px solid #333",
  },
  ingredientsSummary: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
    justifyContent: "center",
  },
  ingredientChip: {
    background: "#1e1e1e",
    color: "#ccc",
    border: "1px solid #333",
    borderRadius: 20,
    padding: "5px 12px",
    fontSize: 13,
  },
  doneSub: {
    color: "#888",
    textAlign: "center",
    fontSize: 15,
    margin: 0,
    lineHeight: 1.5,
  },
};