"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import WatchMeCookModal from "./components/WatchMeCookModal";

interface Substitute {
  substitute: string;
  rationale: string;
}

// ── Order sheet state ──────────────────────────────────────────────────────
interface OrderSheet {
  recipe: Recipe;
  selected: Set<string>;
}

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
  const [pantryIngredients, setPantryIngredients] = useState<string[]>([]);
  const [newIngredient, setNewIngredient] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  // Pantry drawer
  const [pantryDrawerOpen, setPantryDrawerOpen] = useState(false);
  const [pantryItems, setPantryItems] = useState<{ id: number; ingredient: string }[]>([]);
  const [pantryLoading, setPantryLoading] = useState(false);

  const [recentRecipes, setRecentRecipes] = useState<(Recipe & { uuid: string; last_cooked_at: string | null })[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [cachedRecipeUuids, setCachedRecipeUuids] = useState<Set<string>>(new Set());

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeUuids, setRecipeUuids] = useState<Record<string, string>>({});
  // Per-recipe adapt controls: keyed by recipe index
  const [adaptMultiplier, setAdaptMultiplier] = useState<Record<number, number>>({});
  const [adaptDifficulty, setAdaptDifficulty] = useState<Record<number, string>>({});
  const [adaptLoading, setAdaptLoading] = useState<Record<number, boolean>>({});
  const [adaptedRecipes, setAdaptedRecipes] = useState<Record<number, Recipe>>({});
  const [activeRecipe, setActiveRecipe] = useState<Recipe | null>(null);
  const [activeRecipeUuid, setActiveRecipeUuid] = useState<string | null>(null);
  const [pendingRecipe, setPendingRecipe] = useState<Recipe | null>(null);
  const [showWatchModal, setShowWatchModal] = useState(false);
  const [orderSheet, setOrderSheet] = useState<OrderSheet | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderToast, setOrderToast] = useState(false);
  const [cookingStep, setCookingStep] = useState(0);
  const [listeningForNext, setListeningForNext] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [recipeError, setRecipeError] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [stepTimerTotal, setStepTimerTotal] = useState(0);
  const [stepTimerLeft, setStepTimerLeft] = useState(0);
  const [stepTimerDone, setStepTimerDone] = useState(false);

  // Substitute sheet
  const [subSheetOpen, setSubSheetOpen] = useState(false);
  const [subIngredient, setSubIngredient] = useState("");
  const [substitutes, setSubstitutes] = useState<Substitute[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [subError, setSubError] = useState("");

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
  const warningIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Format a duration in seconds to a human-readable speech string */
  const formatDurationSpeech = useCallback((seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts: string[] = [];
    if (h > 0) parts.push(`${h} hour${h !== 1 ? "s" : ""}`);
    if (m > 0) parts.push(`${m} minute${m !== 1 ? "s" : ""}`);
    if (s > 0 && h === 0) parts.push(`${s} second${s !== 1 ? "s" : ""}`);
    return parts.join(" and ");
  }, []);

  /** Format seconds as MM:SS for the ring display */
  const formatTimerDisplay = useCallback((seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, []);

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

  // Show toast if returning from a successful Stripe checkout
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("order") === "success") {
      setOrderToast(true);
      // Clean the URL without a reload
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
      setTimeout(() => setOrderToast(false), 5000);
    }
  }, []);

  const loadRecentRecipes = useCallback(async () => {
    setRecentLoading(true);
    try {
      const res = await fetch("/api/recipes");
      if (res.ok) {
        const { recipes: rows } = await res.json();
        // Parse JSONB fields that come back as strings from Postgres
        const parsed = (rows || []).slice(0, 5).map((r: any) => ({
          ...r,
          ingredients_used: typeof r.ingredients_used === "string" ? JSON.parse(r.ingredients_used) : (r.ingredients_used ?? []),
          extra_ingredients_needed: typeof r.extra_ingredients_needed === "string" ? JSON.parse(r.extra_ingredients_needed) : (r.extra_ingredients_needed ?? []),
          steps: typeof r.steps === "string" ? JSON.parse(r.steps) : (r.steps ?? []),
        }));
        setRecentRecipes(parsed);
      }
    } catch {}
    setRecentLoading(false);
  }, []);

  // Check session on mount, and load pantry if authenticated
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then(async (data) => {
        if (data.email) {
          setUser({ email: data.email });
          // Pre-load pantry ingredients
          try {
            const pr = await fetch("/api/pantry");
            if (pr.ok) {
              const { items } = await pr.json();
              const names: string[] = (items || []).map((it: { id: number; ingredient: string }) => it.ingredient);
              setPantryIngredients(names);
              setPantryItems(items || []);
            }
          } catch {}
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
    clearStepTimer();

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

      // Check if this step has a duration — if so, start a countdown timer
      const duration = parseStepDuration(current.instruction);
      if (duration > 0) {
        // Announce the timer starting
        const announceUtt = new SpeechSynthesisUtterance(
          `Timer started for ${formatDurationSpeech(duration)}.`
        );
        announceUtt.rate = 0.95;
        announceUtt.lang = "en-US";

        // Track whether we've already spoken the "2 minutes left" warning
        let warned = false;

        announceUtt.onend = () => {
          if (synthStopRef.current) return;

          startStepTimer(duration, () => {
            // onDone: speak "time's up" then start listening
            if (synthStopRef.current) return;
            const doneUtt = new SpeechSynthesisUtterance(
              "Time's up! Say next when you're ready to continue."
            );
            doneUtt.rate = 0.95;
            doneUtt.lang = "en-US";
            doneUtt.onend = () => {
              if (!synthStopRef.current) startListening();
            };
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(doneUtt);
          });

          // Set up a watcher to speak the "2 minutes left" warning
          const warningInterval = setInterval(() => {
            if (synthStopRef.current) { clearInterval(warningInterval); return; }
            setStepTimerLeft((left) => {
              // Warn at exactly 120 s (or when ≤120 s remain if we somehow skipped it)
              if (!warned && left > 0 && left <= 120 && duration > 150) {
                warned = true;
                clearInterval(warningInterval);
                if (!synthStopRef.current && !window.speechSynthesis.speaking) {
                  const warnUtt = new SpeechSynthesisUtterance("2 minutes left.");
                  warnUtt.rate = 0.95;
                  warnUtt.lang = "en-US";
                  window.speechSynthesis.speak(warnUtt);
                }
              }
              return left; // don't mutate
            });
          }, 1000);

          // Store the warning interval id so cleanup can clear it
          (warningIntervalRef as React.MutableRefObject<ReturnType<typeof setInterval> | null>).current = warningInterval;
        };

        window.speechSynthesis.speak(announceUtt);
      } else {
        // No timer — go straight to listening
        startListening();
      }
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
      clearStepTimer();
      if (warningIntervalRef.current) {
        clearInterval(warningIntervalRef.current);
        warningIntervalRef.current = null;
      }
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

      // Merge detected with pantry: pantry items come first, deduped
      const detectedClean = detected.filter((i) => typeof i === "string" && i.trim());
      const pantrySet = new Set(pantryIngredients.map((p) => p.toLowerCase()));
      const merged = [
        ...pantryIngredients,
        ...detectedClean.filter((d) => !pantrySet.has(d.toLowerCase())),
      ];
      setIngredients(merged.length > 0 ? merged : detectedClean);
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

  const handleAdaptRecipe = useCallback(async (index: number, baseRecipe: Recipe) => {
    const multiplier = adaptMultiplier[index] ?? 1;
    const difficulty = adaptDifficulty[index] ?? "as-is";
    if (multiplier === 1 && difficulty === "as-is") return;
    setAdaptLoading((prev) => ({ ...prev, [index]: true }));
    try {
      const res = await fetch("/api/recipes/adapt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe: baseRecipe, multiplier, difficulty }),
      });
      if (!res.ok) throw new Error("Adapt failed");
      const { recipe: adapted } = await res.json();
      setAdaptedRecipes((prev) => ({ ...prev, [index]: adapted }));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Could not adapt recipe. Please try again.");
    } finally {
      setAdaptLoading((prev) => ({ ...prev, [index]: false }));
    }
  }, [adaptMultiplier, adaptDifficulty]);

  // ── Offline detection ──────────────────────────────────────────────────────
  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOffline(!navigator.onLine);
    const goOnline  = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── Pre-cache a recipe via the service worker ──────────────────────────────
  const precacheRecipe = useCallback((uuid: string) => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const url = `/api/recipes/${uuid}`;
    navigator.serviceWorker.ready.then((reg) => {
      reg.active?.postMessage({ type: "PRECACHE_RECIPE", url });
    }).catch(() => {});
  }, []);

  const startCooking = useCallback((recipe: Recipe) => {
    const uuid = recipeUuids[recipe.title] ?? null;
    setActiveRecipe(recipe);
    setActiveRecipeUuid(uuid);
    setCookingStep(0);
    // Pre-cache the recipe so it's available offline
    if (uuid) precacheRecipe(uuid);
    setAppState("cooking");
  }, [recipeUuids, precacheRecipe]);

  const requestStartCooking = useCallback((recipe: Recipe) => {
    setPendingRecipe(recipe);
    setShowWatchModal(true);
  }, []);

  const openOrderSheet = useCallback((recipe: Recipe, e: React.MouseEvent) => {
    e.stopPropagation();
    const missing = recipe.extra_ingredients_needed ?? [];
    setOrderSheet({ recipe, selected: new Set(missing) });
  }, []);

  const toggleOrderItem = useCallback((item: string) => {
    setOrderSheet((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.selected);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return { ...prev, selected: next };
    });
  }, []);

  const handleOrder = useCallback(async () => {
    if (!orderSheet || orderSheet.selected.size === 0 || !user) return;
    setOrderLoading(true);
    try {
      const items = Array.from(orderSheet.selected).map((name) => ({
        name,
        amount_cents: 100, // £1 placeholder per ingredient
        quantity: 1,
        seller_email: user.email,
      }));
      const res = await fetch("/api/marketplace/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("Checkout failed");
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Could not start checkout. Please try again.");
    } finally {
      setOrderLoading(false);
    }
  }, [orderSheet, user]);

  const markCooked = useCallback(async (uuid: string) => {
    try {
      await fetch("/api/recipes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid }),
      });
    } catch {}
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
    setActiveRecipeUuid(null);
    setCookingStep(0);
    setAppState("recipes");
  }, []);

  const savePantry = useCallback(async (items: string[]) => {
    try {
      await fetch("/api/pantry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredients: items }),
      });
      // Refresh local pantry state
      const pr = await fetch("/api/pantry");
      if (pr.ok) {
        const { items: saved } = await pr.json();
        const names: string[] = (saved || []).map((it: { id: number; ingredient: string }) => it.ingredient);
        setPantryIngredients(names);
        setPantryItems(saved || []);
      }
    } catch {}
  }, []);

  const findRecipes = useCallback(async () => {
    if (ingredients.length === 0) return;
    setRecipeError("");
    // Auto-save confirmed ingredients to pantry before searching
    savePantry(ingredients);
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
      const valid = parsed.filter((r) => r && r.title && Array.isArray(r.steps));
      setRecipes(valid);

      // Persist recipes to DB and collect UUIDs for sharing
      try {
        const uuidMap: Record<string, string> = {};
        await Promise.all(
          valid.map(async (recipe) => {
            const saveRes = await fetch("/api/recipes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ recipe }),
            });
            if (saveRes.ok) {
              const { uuid } = await saveRes.json();
              if (uuid) uuidMap[recipe.title] = uuid;
            }
          })
        );
        setRecipeUuids(uuidMap);
      } catch {
        // non-fatal — sharing just won't have a UUID
      }

      setAppState("recipes");
    } catch (err: unknown) {
      setRecipeError(err instanceof Error ? err.message : "Failed to find recipes");
      setAppState("ingredients");
    }
  }, [ingredients]);

  const loadPantryDrawer = useCallback(async () => {
    setPantryLoading(true);
    try {
      const pr = await fetch("/api/pantry");
      if (pr.ok) {
        const { items } = await pr.json();
        setPantryItems(items || []);
        const names: string[] = (items || []).map((it: { id: number; ingredient: string }) => it.ingredient);
        setPantryIngredients(names);
      }
    } catch {}
    setPantryLoading(false);
  }, []);

  const removePantryItem = useCallback(async (id: number) => {
    try {
      await fetch("/api/pantry", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setPantryItems((prev) => prev.filter((it) => it.id !== id));
      setPantryIngredients((prev) => {
        const removed = pantryItems.find((it) => it.id === id);
        if (!removed) return prev;
        return prev.filter((p) => p !== removed.ingredient);
      });
    } catch {}
  }, [pantryItems]);

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
    setRecipeUuids({});
    setActiveRecipe(null);
    setActiveRecipeUuid(null);
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

  // ── Load recent recipes when home screen mounts ────────────────────────
  useEffect(() => {
    if (appState === "home" && user) {
      loadRecentRecipes();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState, user]);

  // ── Check which recent recipes are cached for offline use ─────────────
  useEffect(() => {
    if (appState !== "home" || recentRecipes.length === 0) return;
    if (typeof window === "undefined" || !("caches" in window)) return;
    window.caches.open("recipes-v1").then((cache) => {
      Promise.all(
        recentRecipes.map((r) =>
          cache.match(`/api/recipes/${r.uuid}`).then((hit) => hit ? r.uuid : null)
        )
      ).then((results) => {
        const cached = new Set<string>(results.filter((u): u is string => u !== null));
        setCachedRecipeUuids(cached);
      });
    }).catch(() => {});
  }, [appState, recentRecipes]);

  // ── Helper: format a UTC date string as a relative label ──────────────
  const formatRelativeDate = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

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
            <button
              style={styles.pantryBtn}
              onClick={() => { setPantryDrawerOpen(true); loadPantryDrawer(); }}
            >
              🥫 Manage pantry
              {pantryIngredients.length > 0 && (
                <span style={styles.pantryCount}>{pantryIngredients.length}</span>
              )}
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />

          {/* Recent Recipes */}
          <div style={styles.recentSection}>
            <div style={styles.recentHeader}>
              <span style={styles.recentTitle}>Recent Recipes</span>
              <button
                style={styles.recentRefreshBtn}
                onClick={loadRecentRecipes}
                disabled={recentLoading}
                aria-label="Refresh recent recipes"
              >
                {recentLoading ? "…" : "↻"}
              </button>
            </div>

            {recentLoading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
                <div style={styles.spinner} />
              </div>
            ) : recentRecipes.length === 0 ? (
              <p style={styles.recentEmpty}>
                No recipes yet — take a photo to get started!
              </p>
            ) : (
              <div style={styles.recentList}>
                {recentRecipes.map((r) => (
                  <button
                    key={r.uuid}
                    style={styles.recentCard}
                    onClick={() => {
                      // Jump straight into cooking without re-scanning
                      setActiveRecipe(r);
                      setActiveRecipeUuid(r.uuid);
                      setCookingStep(0);
                      precacheRecipe(r.uuid);
                      setAppState("cooking");
                    }}
                  >
                    <div style={styles.recentCardInner}>
                      <div style={styles.recentCardLeft}>
                        <span style={styles.recentCardTitle}>{r.title}</span>
                        <span style={styles.recentCardMeta}>
                          {r.total_time_minutes ? `⏱ ${r.total_time_minutes} min · ` : ""}
                          {r.difficulty ?? ""}
                          {r.last_cooked_at
                            ? ` · cooked ${formatRelativeDate(r.last_cooked_at)}`
                            : ""}
                        </span>
                        {cachedRecipeUuids.has(r.uuid) && (
                          <span style={styles.offlineBadge}>✅ Saved for offline</span>
                        )}
                      </div>
                      <span style={styles.recentCardArrow}>▶</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <p style={styles.footerNote}>Signed in as {user?.email}</p>

        {/* Pantry drawer backdrop */}
        {pantryDrawerOpen && (
          <div
            style={styles.drawerBackdrop}
            onClick={() => setPantryDrawerOpen(false)}
          />
        )}

        {/* Pantry drawer */}
        <div style={{
          ...styles.drawer,
          transform: pantryDrawerOpen ? "translateY(0)" : "translateY(100%)",
        }}>
          <div style={styles.drawerHandle} />
          <div style={styles.drawerHeader}>
            <h3 style={styles.drawerTitle}>🥫 Your Pantry</h3>
            <button style={styles.drawerClose} onClick={() => setPantryDrawerOpen(false)}>✕</button>
          </div>
          <p style={styles.drawerSub}>
            These ingredients are pre-loaded whenever you start a new session.
          </p>

          {pantryLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
              <div style={styles.spinner} />
            </div>
          ) : pantryItems.length === 0 ? (
            <p style={styles.drawerEmpty}>
              No pantry items yet. Confirm an ingredients list to save them here.
            </p>
          ) : (
            <ul style={styles.pantryList}>
              {pantryItems.map((item) => (
                <li key={item.id} style={styles.pantryListItem}>
                  <span style={styles.pantryItemLabel}>{item.ingredient}</span>
                  <button
                    style={styles.pantryRemoveBtn}
                    onClick={() => removePantryItem(item.id)}
                    aria-label={`Remove ${item.ingredient}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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

          {pantryIngredients.length > 0 && (
            <div style={styles.pantryBadgeRow}>
              <span style={styles.pantryBadge}>🥫 From your pantry</span>
              <span style={styles.pantryBadgeSub}>
                {pantryIngredients.filter((p) => ingredients.map(i => i.toLowerCase()).includes(p.toLowerCase())).length} item{pantryIngredients.filter((p) => ingredients.map(i => i.toLowerCase()).includes(p.toLowerCase())).length !== 1 ? "s" : ""} pre-loaded
              </span>
            </div>
          )}

          <ul style={styles.ingredientList}>
            {ingredients.map((item, i) => (
              <li key={i} style={{
                ...styles.ingredientItem,
                ...(pantryIngredients.some((p) => p.toLowerCase() === item.toLowerCase())
                  ? styles.ingredientItemPantry : {}),
              }}>
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
                    {pantryIngredients.some((p) => p.toLowerCase() === item.toLowerCase()) && (
                      <span style={styles.pantryPip}>🥫</span>
                    )}
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

          {/* ── Order confirmation toast ── */}
          {orderToast && (
            <div style={styles.orderToast}>
              ✅ Order placed! Your ingredients are on their way.
            </div>
          )}

          {/* ── Order bottom sheet ── */}
          {orderSheet && (
            <>
              <div
                style={styles.drawerBackdrop}
                onClick={() => !orderLoading && setOrderSheet(null)}
              />
              <div style={styles.orderSheet}>
                <div style={styles.drawerHandle} />
                <div style={styles.drawerHeader}>
                  <h3 style={styles.drawerTitle}>🛒 Order ingredients</h3>
                  <button
                    style={styles.drawerClose}
                    onClick={() => !orderLoading && setOrderSheet(null)}
                    disabled={orderLoading}
                  >
                    ✕
                  </button>
                </div>
                <p style={styles.orderSheetSub}>
                  Select the items you need for{" "}
                  <strong style={{ color: "#fff" }}>{orderSheet.recipe.title}</strong>.
                  Each item is charged at a £1 placeholder price.
                </p>

                <ul style={styles.orderItemList}>
                  {(orderSheet.recipe.extra_ingredients_needed ?? []).map((item) => (
                    <li key={item} style={styles.orderItem}>
                      <label style={styles.orderItemLabel}>
                        <input
                          type="checkbox"
                          checked={orderSheet.selected.has(item)}
                          onChange={() => toggleOrderItem(item)}
                          style={styles.orderCheckbox}
                          disabled={orderLoading}
                        />
                        <span style={styles.orderItemText}>{item}</span>
                        <span style={styles.orderItemPrice}>£1.00</span>
                      </label>
                    </li>
                  ))}
                </ul>

                <div style={styles.orderTotalRow}>
                  <span style={styles.orderTotalLabel}>Total</span>
                  <span style={styles.orderTotalValue}>
                    £{orderSheet.selected.size}.00
                  </span>
                </div>

                <button
                  style={{
                    ...styles.primaryBtn,
                    ...(orderSheet.selected.size === 0 || orderLoading
                      ? { opacity: 0.4, cursor: "not-allowed" }
                      : {}),
                  }}
                  onClick={handleOrder}
                  disabled={orderSheet.selected.size === 0 || orderLoading}
                >
                  {orderLoading
                    ? "Redirecting to checkout…"
                    : `🛒 Order ${orderSheet.selected.size} item${orderSheet.selected.size !== 1 ? "s" : ""}`}
                </button>
                <button
                  style={styles.ghostBtn}
                  onClick={() => setOrderSheet(null)}
                  disabled={orderLoading}
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {showWatchModal && pendingRecipe && (
            <WatchMeCookModal
              recipeName={pendingRecipe.title}
              stepCount={pendingRecipe.steps.length}
              onConfirm={() => {
                setShowWatchModal(false);
                startCooking(pendingRecipe);
                setPendingRecipe(null);
              }}
              onCancel={() => {
                setShowWatchModal(false);
                startCooking(pendingRecipe);
                setPendingRecipe(null);
              }}
            />
          )}

          {recipes
            .slice()
            .sort((a, b) =>
              (a.extra_ingredients_needed?.length ?? 0) -
              (b.extra_ingredients_needed?.length ?? 0)
            )
            .map((recipe, sortedI) => {
              // Find the original index so adapt state keys are stable
              const i = recipes.indexOf(recipe);
              const displayRecipe = adaptedRecipes[i] ?? recipe;
              const missing = displayRecipe.extra_ingredients_needed ?? [];
              const canCookNow = missing.length === 0;
              const almostThere = missing.length > 0 && missing.length <= 2;
              const multiplier = adaptMultiplier[i] ?? 1;
              const difficulty = adaptDifficulty[i] ?? "as-is";
              const isAdapted = !!adaptedRecipes[i];
              const isLoading = !!adaptLoading[i];
              const isDirty = multiplier !== 1 || difficulty !== "as-is";
              return (
                <div
                  key={sortedI}
                  style={{
                    ...styles.recipeCard,
                    ...(canCookNow ? styles.recipeCardReady : {}),
                    ...(almostThere ? styles.recipeCardAlmost : {}),
                  }}
                >
                  <div style={styles.recipeCardHeader}>
                    <span style={styles.recipeTitle}>{displayRecipe.title}</span>
                    <span style={styles.recipeBadge}>{displayRecipe.difficulty}</span>
                  </div>

                  {/* Ready / Almost badge */}
                  {canCookNow ? (
                    <div style={styles.readyBadge}>✅ Ready to cook</div>
                  ) : (
                    <div style={styles.almostBadge}>
                      🟡 Need {missing.length} item{missing.length !== 1 ? "s" : ""}
                    </div>
                  )}

                  <p style={styles.recipeDesc}>{displayRecipe.description}</p>

                  {/* ── Adapt controls ── */}
                  <div style={styles.adaptSection} onClick={(e) => e.stopPropagation()}>
                    <div style={styles.adaptRow}>
                      <span style={styles.adaptLabel}>Servings</span>
                      <div style={styles.adaptPillGroup}>
                        {([0.5, 1, 2, 4] as const).map((m) => (
                          <button
                            key={m}
                            style={{
                              ...styles.adaptPill,
                              ...(multiplier === m ? styles.adaptPillActive : {}),
                            }}
                            onClick={() => {
                              setAdaptMultiplier((prev) => ({ ...prev, [i]: m }));
                              setAdaptedRecipes((prev) => {
                                const next = { ...prev };
                                delete next[i];
                                return next;
                              });
                            }}
                          >
                            {m === 0.5 ? "½×" : `${m}×`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={styles.adaptRow}>
                      <span style={styles.adaptLabel}>Style</span>
                      <div style={styles.adaptPillGroup}>
                        {(["simplify", "as-is", "challenge"] as const).map((d) => (
                          <button
                            key={d}
                            style={{
                              ...styles.adaptPill,
                              ...(difficulty === d ? styles.adaptPillActive : {}),
                            }}
                            onClick={() => {
                              setAdaptDifficulty((prev) => ({ ...prev, [i]: d }));
                              setAdaptedRecipes((prev) => {
                                const next = { ...prev };
                                delete next[i];
                                return next;
                              });
                            }}
                          >
                            {d === "simplify" ? "Simplify" : d === "as-is" ? "As-is" : "Challenge me"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {isDirty && (
                      <button
                        style={{
                          ...styles.adaptApplyBtn,
                          ...(isLoading ? { opacity: 0.5, cursor: "not-allowed" } : {}),
                        }}
                        disabled={isLoading}
                        onClick={() => handleAdaptRecipe(i, recipe)}
                      >
                        {isLoading
                          ? "✨ Adapting…"
                          : isAdapted
                          ? "✨ Re-adapt recipe"
                          : "✨ Adapt recipe"}
                      </button>
                    )}
                    {isAdapted && !isLoading && (
                      <div style={styles.adaptedBadge}>✨ Adapted</div>
                    )}
                  </div>

                  {/* Missing ingredient tags + order button */}
                  {missing.length > 0 && (
                    <>
                      <div style={styles.missingRow}>
                        {missing.map((ing, j) => (
                          <span key={j} style={styles.missingTag}>{ing}</span>
                        ))}
                      </div>
                      <button
                        style={styles.orderMissingBtn}
                        onClick={(e) => openOrderSheet(displayRecipe, e)}
                      >
                        🛒 Order missing ingredients
                      </button>
                    </>
                  )}

                  {displayRecipe.source_inspiration && (
                    <p style={styles.recipeSource}>🔗 {displayRecipe.source_inspiration}</p>
                  )}
                  <div style={styles.recipeMeta}>
                    <span>⏱ {displayRecipe.total_time_minutes} min</span>
                    <span>📋 {displayRecipe.steps.length} steps</span>
                  </div>

                  <button
                    style={styles.startCookingBtn}
                    onClick={() => requestStartCooking(displayRecipe)}
                  >
                    🍳 Start cooking
                  </button>
                </div>
              );
            })}

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
        {/* Offline banner */}
        {isOffline && (
          <div style={styles.offlineBanner}>
            📴 Offline – using saved recipe
          </div>
        )}
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

          {/* Substitute button */}
          <button
            style={styles.subBtn}
            onClick={() => {
              // Default to first ingredient in recipe; user can pick from the sheet
              const allIngredients = [
                ...(activeRecipe.ingredients_used ?? []),
                ...(activeRecipe.extra_ingredients_needed ?? []),
              ];
              setSubIngredient(allIngredients[0] ?? "");
              setSubstitutes([]);
              setSubError("");
              setSubSheetOpen(true);
            }}
          >
            🔄 Substitute?
          </button>

          {/* Ring timer — only shown when a timed step is active */}
          {stepTimerTotal > 0 && (
            <div style={styles.timerRingWrap}>
              {(() => {
                const SIZE = 120;
                const STROKE = 8;
                const R = (SIZE - STROKE) / 2;
                const CIRC = 2 * Math.PI * R;
                const fraction = stepTimerDone
                  ? 0
                  : stepTimerTotal > 0
                  ? stepTimerLeft / stepTimerTotal
                  : 1;
                const dashOffset = CIRC * (1 - fraction);
                const color = stepTimerDone
                  ? "#22c55e"
                  : stepTimerLeft <= 30
                  ? "#ef4444"
                  : stepTimerLeft <= 120
                  ? "#f59e0b"
                  : "#FF6B35";
                return (
                  <svg width={SIZE} height={SIZE} style={{ display: "block" }}>
                    {/* Track */}
                    <circle
                      cx={SIZE / 2}
                      cy={SIZE / 2}
                      r={R}
                      fill="none"
                      stroke="#222"
                      strokeWidth={STROKE}
                    />
                    {/* Progress arc */}
                    <circle
                      cx={SIZE / 2}
                      cy={SIZE / 2}
                      r={R}
                      fill="none"
                      stroke={color}
                      strokeWidth={STROKE}
                      strokeLinecap="round"
                      strokeDasharray={CIRC}
                      strokeDashoffset={dashOffset}
                      transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                      style={{ transition: "stroke-dashoffset 0.9s linear, stroke 0.4s" }}
                    />
                    {/* Time label */}
                    <text
                      x={SIZE / 2}
                      y={SIZE / 2 - 6}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={stepTimerDone ? "#22c55e" : "#fff"}
                      fontSize="18"
                      fontWeight="800"
                      fontFamily="monospace"
                    >
                      {stepTimerDone ? "✓" : formatTimerDisplay(stepTimerLeft)}
                    </text>
                    {/* "done" / "timer" sub-label */}
                    <text
                      x={SIZE / 2}
                      y={SIZE / 2 + 14}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#666"
                      fontSize="10"
                      fontWeight="600"
                    >
                      {stepTimerDone ? "DONE" : "TIMER"}
                    </text>
                  </svg>
                );
              })()}
              {stepTimerDone && (
                <p style={styles.timerDoneLabel}>⏰ Time's up — say "next" or tap below</p>
              )}
            </div>
          )}

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

        {/* ── Substitute bottom sheet ── */}
        {subSheetOpen && (
          <>
            <div
              style={styles.drawerBackdrop}
              onClick={() => setSubSheetOpen(false)}
            />
            <div style={styles.subSheet}>
              <div style={styles.drawerHandle} />
              <div style={styles.drawerHeader}>
                <h3 style={styles.drawerTitle}>🔄 Ingredient Substitute</h3>
                <button
                  style={styles.drawerClose}
                  onClick={() => setSubSheetOpen(false)}
                >
                  ✕
                </button>
              </div>

              {/* Ingredient picker */}
              <p style={styles.subSheetSub}>
                Which ingredient do you need to substitute?
              </p>
              <div style={styles.subIngredientRow}>
                {[
                  ...(activeRecipe.ingredients_used ?? []),
                  ...(activeRecipe.extra_ingredients_needed ?? []),
                ].map((ing) => (
                  <button
                    key={ing}
                    style={{
                      ...styles.subIngredientChip,
                      ...(subIngredient === ing ? styles.subIngredientChipActive : {}),
                    }}
                    onClick={() => {
                      setSubIngredient(ing);
                      setSubstitutes([]);
                      setSubError("");
                    }}
                  >
                    {ing}
                  </button>
                ))}
              </div>

              {/* Find substitutes button */}
              <button
                style={{
                  ...styles.primaryBtn,
                  marginTop: 8,
                  opacity: subLoading || !subIngredient ? 0.5 : 1,
                }}
                disabled={subLoading || !subIngredient}
                onClick={async () => {
                  if (!subIngredient) return;
                  setSubLoading(true);
                  setSubError("");
                  setSubstitutes([]);
                  try {
                    const res = await fetch("/api/substitute", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        ingredient: subIngredient,
                        recipeTitle: activeRecipe.title,
                        stepInstruction: current.instruction,
                      }),
                    });
                    if (!res.ok) throw new Error("Request failed");
                    const { substitutes: subs, error } = await res.json();
                    if (error) throw new Error(error);
                    setSubstitutes(subs ?? []);
                  } catch (err: unknown) {
                    setSubError(err instanceof Error ? err.message : "Something went wrong");
                  } finally {
                    setSubLoading(false);
                  }
                }}
              >
                {subLoading ? "Finding substitutes…" : "🔍 Find substitutes"}
              </button>

              {subError && <p style={styles.error}>{subError}</p>}

              {/* Results */}
              {substitutes.length > 0 && (
                <div style={styles.subResultList}>
                  {substitutes.map((s, i) => (
                    <div key={i} style={styles.subCard}>
                      <span style={styles.subCardTitle}>{s.substitute}</span>
                      <span style={styles.subCardRationale}>{s.rationale}</span>
                    </div>
                  ))}
                </div>
              )}

              <button
                style={{ ...styles.ghostBtn, marginTop: 8 }}
                onClick={() => setSubSheetOpen(false)}
              >
                ✓ Got it — continue cooking
              </button>
            </div>
          </>
        )}

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
                if (activeRecipeUuid) markCooked(activeRecipeUuid);
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
    const shareUrl = activeRecipeUuid
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/recipe/${activeRecipeUuid}`
      : null;

    const handleShare = async () => {
      if (!shareUrl) return;
      if (navigator.share) {
        try {
          await navigator.share({
            title: activeRecipe ? `${activeRecipe.title} — Sous` : "Recipe from Sous",
            text: activeRecipe
              ? `I just cooked ${activeRecipe.title} with Sous! Check out the recipe:`
              : "Check out this recipe from Sous:",
            url: shareUrl,
          });
        } catch {
          // user cancelled or share failed — fall through to clipboard
          try { await navigator.clipboard.writeText(shareUrl); alert("Link copied!"); } catch {}
        }
      } else {
        try {
          await navigator.clipboard.writeText(shareUrl);
          alert("Recipe link copied to clipboard!");
        } catch {
          prompt("Copy this link:", shareUrl);
        }
      }
    };

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
          {shareUrl && (
            <button style={styles.shareBtn} onClick={handleShare}>
              🔗 Share this recipe
            </button>
          )}
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
  recipeCardReady: {
    borderColor: "#22c55e33",
    background: "#0f1a0f",
  },
  recipeCardAlmost: {
    borderColor: "#f59e0b33",
    background: "#1a160a",
  },
  readyBadge: {
    display: "inline-flex",
    alignSelf: "flex-start",
    background: "#14532d",
    color: "#86efac",
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 20,
    padding: "4px 12px",
    border: "1px solid #22c55e44",
    letterSpacing: 0.2,
  },
  almostBadge: {
    display: "inline-flex",
    alignSelf: "flex-start",
    background: "#451a03",
    color: "#fcd34d",
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 20,
    padding: "4px 12px",
    border: "1px solid #f59e0b44",
    letterSpacing: 0.2,
  },
  missingRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
    marginTop: 2,
  },
  missingTag: {
    background: "#292010",
    color: "#fbbf24",
    border: "1px solid #f59e0b55",
    borderRadius: 20,
    padding: "3px 10px",
    fontSize: 12,
    fontWeight: 600,
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

  // Pantry button on home
  pantryBtn: {
    background: "#1a2a1a",
    color: "#86efac",
    border: "1px solid #22c55e44",
    borderRadius: 16,
    padding: "14px 24px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    transition: "opacity 0.2s",
  },
  pantryCount: {
    background: "#22c55e",
    color: "#fff",
    borderRadius: 20,
    padding: "2px 8px",
    fontSize: 12,
    fontWeight: 800,
  },

  // Pantry drawer
  drawerBackdrop: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    zIndex: 200,
  },
  drawer: {
    position: "fixed" as const,
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "75dvh",
    background: "#161616",
    borderRadius: "24px 24px 0 0",
    zIndex: 201,
    padding: "12px 20px 48px",
    overflowY: "auto" as const,
    transition: "transform 0.35s cubic-bezier(0.32,0.72,0,1)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    boxShadow: "0 -4px 40px rgba(0,0,0,0.6)",
  },
  drawerHandle: {
    width: 40,
    height: 4,
    background: "#333",
    borderRadius: 2,
    alignSelf: "center" as const,
    marginBottom: 8,
    flexShrink: 0,
  },
  drawerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexShrink: 0,
  },
  drawerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: 800,
    margin: 0,
  },
  drawerClose: {
    background: "#222",
    color: "#888",
    border: "none",
    borderRadius: "50%",
    width: 36,
    height: 36,
    fontSize: 16,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  drawerSub: {
    color: "#666",
    fontSize: 13,
    margin: "4px 0 8px",
    lineHeight: 1.5,
    flexShrink: 0,
  },
  drawerEmpty: {
    color: "#555",
    fontSize: 14,
    textAlign: "center" as const,
    padding: "24px 0",
  },
  pantryList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  pantryListItem: {
    display: "flex",
    alignItems: "center",
    background: "#1e1e1e",
    borderRadius: 12,
    padding: "10px 14px",
    gap: 8,
  },
  pantryItemLabel: {
    flex: 1,
    color: "#ccc",
    fontSize: 15,
    textTransform: "capitalize" as const,
  },
  pantryRemoveBtn: {
    background: "transparent",
    border: "none",
    color: "#555",
    fontSize: 16,
    cursor: "pointer",
    padding: "4px 6px",
    lineHeight: 1,
    flexShrink: 0,
  },

  // Pantry badge on ingredients screen
  pantryBadgeRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#0f1f0f",
    border: "1px solid #22c55e33",
    borderRadius: 12,
    padding: "8px 14px",
  },
  pantryBadge: {
    color: "#86efac",
    fontSize: 13,
    fontWeight: 700,
  },
  pantryBadgeSub: {
    color: "#4ade80",
    fontSize: 12,
    opacity: 0.7,
  },
  ingredientItemPantry: {
    borderLeft: "3px solid #22c55e55",
  },
  pantryPip: {
    fontSize: 11,
    marginLeft: 6,
    opacity: 0.7,
  },

  // Order sheet
  orderSheet: {
    position: "fixed" as const,
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "80dvh",
    background: "#161616",
    borderRadius: "24px 24px 0 0",
    zIndex: 201,
    padding: "12px 20px 48px",
    overflowY: "auto" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    boxShadow: "0 -4px 40px rgba(0,0,0,0.7)",
  },
  orderSheetSub: {
    color: "#888",
    fontSize: 13,
    lineHeight: 1.55,
    margin: "4px 0 8px",
  },
  orderItemList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  orderItem: {
    background: "#1e1e1e",
    borderRadius: 12,
    padding: "12px 14px",
  },
  orderItemLabel: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    cursor: "pointer",
    width: "100%",
  },
  orderCheckbox: {
    width: 18,
    height: 18,
    flexShrink: 0,
    accentColor: "#FF6B35",
    cursor: "pointer",
  },
  orderItemText: {
    flex: 1,
    color: "#ccc",
    fontSize: 15,
    textTransform: "capitalize" as const,
  },
  orderItemPrice: {
    color: "#666",
    fontSize: 13,
    fontWeight: 600,
    flexShrink: 0,
  },
  orderTotalRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 4px 4px",
    borderTop: "1px solid #222",
    marginTop: 4,
  },
  orderTotalLabel: {
    color: "#888",
    fontSize: 15,
    fontWeight: 600,
  },
  orderTotalValue: {
    color: "#fff",
    fontSize: 20,
    fontWeight: 800,
  },
  // Adapt controls
  adaptSection: {
    background: "#111",
    border: "1px solid #222",
    borderRadius: 14,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
  },
  adaptRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap" as const,
  },
  adaptLabel: {
    color: "#666",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    minWidth: 56,
    flexShrink: 0,
  },
  adaptPillGroup: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap" as const,
  },
  adaptPill: {
    background: "#1a1a1a",
    color: "#777",
    border: "1px solid #2a2a2a",
    borderRadius: 20,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.15s",
    whiteSpace: "nowrap" as const,
  },
  adaptPillActive: {
    background: "#2a1a0a",
    color: "#FF6B35",
    border: "1px solid #FF6B3566",
  },
  adaptApplyBtn: {
    background: "#1a1228",
    color: "#c4b5fd",
    border: "1px solid #7c3aed55",
    borderRadius: 12,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    width: "100%",
    transition: "opacity 0.2s",
  },
  adaptedBadge: {
    color: "#a78bfa",
    fontSize: 12,
    fontWeight: 700,
    textAlign: "center" as const,
    opacity: 0.8,
  },
  startCookingBtn: {
    background: "#FF6B35",
    color: "#fff",
    border: "none",
    borderRadius: 14,
    padding: "14px 20px",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
    width: "100%",
    marginTop: 4,
    letterSpacing: 0.2,
    transition: "opacity 0.2s",
  },

  orderMissingBtn: {
    background: "#1a1a2e",
    color: "#818cf8",
    border: "1px solid #3730a344",
    borderRadius: 12,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    width: "100%",
    textAlign: "left" as const,
    transition: "opacity 0.2s",
    marginTop: 2,
  },
  orderToast: {
    position: "fixed" as const,
    bottom: 80,
    left: "50%",
    transform: "translateX(-50%)",
    background: "#14532d",
    color: "#86efac",
    border: "1px solid #22c55e55",
    borderRadius: 16,
    padding: "14px 24px",
    fontSize: 15,
    fontWeight: 700,
    zIndex: 999,
    whiteSpace: "nowrap" as const,
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
  },

  shareBtn: {
    background: "#1a1a2e",
    color: "#818cf8",
    border: "1px solid #3730a344",
    borderRadius: 16,
    padding: "16px 24px",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    transition: "opacity 0.2s",
  },

  // Substitute button
  subBtn: {
    background: "#1e1e2e",
    color: "#a78bfa",
    border: "1px solid #4c1d9544",
    borderRadius: 14,
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: 0.2,
    transition: "opacity 0.2s",
  },

  // Substitute bottom sheet
  subSheet: {
    position: "fixed" as const,
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "82dvh",
    background: "#161616",
    borderRadius: "24px 24px 0 0",
    zIndex: 201,
    padding: "12px 20px 48px",
    overflowY: "auto" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
    boxShadow: "0 -4px 40px rgba(0,0,0,0.7)",
  },
  subSheetSub: {
    color: "#888",
    fontSize: 13,
    margin: "4px 0 4px",
    lineHeight: 1.5,
    flexShrink: 0,
  },
  subIngredientRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
  },
  subIngredientChip: {
    background: "#222",
    color: "#ccc",
    border: "1px solid #333",
    borderRadius: 20,
    padding: "7px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
    textTransform: "capitalize" as const,
  },
  subIngredientChipActive: {
    background: "#2e1065",
    color: "#c4b5fd",
    border: "1px solid #7c3aed77",
  },
  subResultList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
    marginTop: 4,
  },
  subCard: {
    background: "#1a1a2e",
    border: "1px solid #3730a333",
    borderRadius: 16,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  subCardTitle: {
    color: "#c4b5fd",
    fontSize: 16,
    fontWeight: 800,
    textTransform: "capitalize" as const,
  },
  subCardRationale: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 1.55,
  },

  // Ring timer
  timerRingWrap: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 10,
  },
  timerDoneLabel: {
    color: "#22c55e",
    fontSize: 13,
    fontWeight: 700,
    margin: 0,
    textAlign: "center" as const,
    animation: "pulse 1.2s ease-in-out infinite",
  },

  // Recent recipes section on home
  recentSection: {
    width: "100%",
    marginTop: 8,
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
  },
  recentHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recentTitle: {
    color: "#fff",
    fontWeight: 700,
    fontSize: 16,
  },
  recentRefreshBtn: {
    background: "transparent",
    border: "none",
    color: "#666",
    fontSize: 20,
    cursor: "pointer",
    lineHeight: 1,
    padding: "4px 8px",
  },
  recentEmpty: {
    color: "#555",
    fontSize: 13,
    textAlign: "center" as const,
    padding: "12px 0",
    margin: 0,
  },
  recentList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  recentCard: {
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: 14,
    padding: "14px 16px",
    cursor: "pointer",
    width: "100%",
    textAlign: "left" as const,
    transition: "border-color 0.15s",
  },
  recentCardInner: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  recentCardLeft: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    minWidth: 0,
  },
  recentCardTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: 700,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  recentCardMeta: {
    color: "#666",
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  recentCardArrow: {
    color: "#FF6B35",
    fontSize: 14,
    flexShrink: 0,
  },
  offlineBadge: {
    display: "inline-block",
    background: "#0d2b0d",
    color: "#4ade80",
    border: "1px solid #22c55e44",
    borderRadius: 20,
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 700,
    marginTop: 2,
    letterSpacing: 0.1,
  },

  // Offline banner
  offlineBanner: {
    background: "#2a1a00",
    color: "#fbbf24",
    border: "1px solid #f59e0b44",
    borderRadius: 0,
    padding: "10px 20px",
    fontSize: 13,
    fontWeight: 700,
    textAlign: "center" as const,
    letterSpacing: 0.2,
    zIndex: 50,
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