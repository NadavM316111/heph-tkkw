"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface RecipeStep {
  step_number: number;
  instruction: string;
}

interface Recipe {
  id: number;
  uuid: string;
  title: string;
  description: string;
  ingredients_used: string[];
  extra_ingredients_needed: string[];
  steps: RecipeStep[];
  total_time_minutes: number;
  difficulty: string;
  cuisine: string;
}

// ── Quantity scaling ──────────────────────────────────────────────────────────

// Matches patterns like:
//   "2 tbsp", "1/2 cup", "1½ tsp", "3-4 cloves", "200g", "0.5 kg"
// Capture groups: [fullMatch, quantity, unit?]
const QTY_RE =
  /\b(\d+(?:[./]\d+)?(?:\s*[–\-]\s*\d+(?:[./]\d+)?)?|\d*[½⅓⅔¼¾⅛⅜⅝⅞])\s*(tbsp|tablespoons?|tsp|teaspoons?|cups?|oz|ounces?|lbs?|pounds?|kg|g|ml|l|litres?|liters?|cloves?|slices?|pieces?|inch(?:es)?|cm|mm|pinch(?:es)?|handfuls?|sprigs?|bunches?|cans?|jars?|packets?|portions?|servings?)?\b/gi;

const VULGAR: Record<string, number> = {
  "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3,
  "¼": 0.25, "¾": 0.75,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};

/** Parse a quantity token (may contain ranges like "2-3" or fractions "1/2") */
function parseQty(raw: string): number | null {
  const t = raw.trim();
  // vulgar fraction alone
  if (VULGAR[t]) return VULGAR[t];
  // "1½" style compound
  for (const [ch, val] of Object.entries(VULGAR)) {
    if (t.endsWith(ch)) {
      const prefix = parseFloat(t.slice(0, -ch.length));
      if (!isNaN(prefix)) return prefix + val;
    }
  }
  // range "2-3" or "2–3" → use midpoint
  const rangeM = t.match(/^(\d+(?:\.\d+)?)\s*[–\-]\s*(\d+(?:\.\d+)?)$/);
  if (rangeM) return (parseFloat(rangeM[1]) + parseFloat(rangeM[2])) / 2;
  // fraction "1/2"
  const fracM = t.match(/^(\d+)\/(\d+)$/);
  if (fracM) return parseInt(fracM[1]) / parseInt(fracM[2]);
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

/** Format a scaled number back to a readable string */
function formatQty(n: number): string {
  // Express very close simple fractions nicely
  const fracs: [number, string][] = [
    [0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.375, "⅜"],
    [0.5, "½"], [0.625, "⅝"], [2 / 3, "⅔"], [0.75, "¾"], [0.875, "⅞"],
  ];
  // whole + vulgar: e.g. 1.5 → "1½"
  const whole = Math.floor(n);
  const frac = n - whole;
  for (const [val, sym] of fracs) {
    if (Math.abs(frac - val) < 0.04) {
      return whole > 0 ? `${whole}${sym}` : sym;
    }
  }
  // whole number
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  // one decimal place
  return n.toFixed(1).replace(/\.0$/, "");
}

/**
 * Returns true if the match looks like a genuine cooking quantity rather than
 * an incidental number (e.g. "step 2", "375°F", "30 minutes").
 */
function looksLikeCookingQty(fullMatch: string, unit: string | undefined): boolean {
  if (unit) return true; // any recognised unit → scale it
  // bare numbers we do NOT auto-scale (temperatures, times, step numbers, etc.)
  return false;
}

/**
 * Scale all recognised quantity mentions in a text string by `multiplier`.
 * Returns the scaled string AND a boolean indicating whether any "ambiguous"
 * quantities (bare numbers without a recognised unit) were skipped.
 */
function scaleText(
  text: string,
  multiplier: number
): { scaled: string; hasAmbiguous: boolean } {
  if (multiplier === 1) return { scaled: text, hasAmbiguous: false };
  let hasAmbiguous = false;

  const scaled = text.replace(QTY_RE, (match, qty, unit) => {
    if (!looksLikeCookingQty(match, unit)) {
      hasAmbiguous = true; // bare number — leave as-is, flag for AI
      return match;
    }
    const val = parseQty(qty);
    if (val === null) {
      hasAmbiguous = true;
      return match;
    }
    const newVal = formatQty(val * multiplier);
    return unit ? `${newVal} ${unit}` : newVal;
  });

  return { scaled, hasAmbiguous };
}

/** Cache for AI-scaled strings: key = `${multiplier}::${originalText}` */
const aiScaleCache = new Map<string, string>();

/**
 * Ask the AI to rewrite a single sentence with scaled quantities.
 * Result is cached so the same sentence is never sent twice.
 */
async function aiScaleText(
  text: string,
  multiplier: number
): Promise<string> {
  const cacheKey = `${multiplier}::${text}`;
  if (aiScaleCache.has(cacheKey)) return aiScaleCache.get(cacheKey)!;

  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system:
          "You rewrite cooking instructions with scaled quantities. " +
          "Return ONLY the rewritten sentence, no explanation, no quotes.",
        messages: [
          {
            role: "user",
            content: `Multiply every quantity in this cooking instruction by ${multiplier}. ` +
              `Do NOT change anything except the numbers/quantities. ` +
              `Instruction: ${text}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error("AI call failed");
    const { text: result } = await res.json();
    const trimmed = result?.trim() ?? text;
    aiScaleCache.set(cacheKey, trimmed);
    return trimmed;
  } catch {
    return text; // graceful fallback: show unscaled
  }
}

// ── Multiplier options ────────────────────────────────────────────────────────
const MULTIPLIERS = [0.5, 1, 2, 3] as const;
type Multiplier = typeof MULTIPLIERS[number];

export default function RecipePage({ params }: { params: { id: string } }) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentStep, setCurrentStep] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [cookMode, setCookMode] = useState(false);
  const [shared, setShared] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [servedFromCache, setServedFromCache] = useState(false);
  const [savedForOffline, setSavedForOffline] = useState(false);
  const recognitionRef = useRef<any>(null);

  // ── Serving multiplier state ──────────────────────────────────────────────
  const [multiplier, setMultiplier] = useState<Multiplier>(1);
  // scaledIngredients / scaledSteps hold the display-ready strings after scaling
  const [scaledIngredients, setScaledIngredients] = useState<string[]>([]);
  const [scaledExtra, setScaledExtra] = useState<string[]>([]);
  const [scaledSteps, setScaledSteps] = useState<RecipeStep[]>([]);
  // Tracks which step indices are currently being AI-resolved
  const [aiPending, setAiPending] = useState<Set<number>>(new Set());

  // Offline detection
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

  // ── Apply scaling whenever recipe or multiplier changes ──────────────────
  useEffect(() => {
    if (!recipe) return;

    // Scale ingredients immediately (regex only)
    const newIngredients = recipe.ingredients_used.map(
      (ing) => scaleText(ing, multiplier).scaled
    );
    const newExtra = (recipe.extra_ingredients_needed ?? []).map(
      (ing) => scaleText(ing, multiplier).scaled
    );
    setScaledIngredients(newIngredients);
    setScaledExtra(newExtra);

    // Scale steps
    const immediateSteps = recipe.steps.map((step) => {
      const { scaled } = scaleText(step.instruction, multiplier);
      return { ...step, instruction: scaled };
    });
    setScaledSteps(immediateSteps);

    // For any step with ambiguous quantities, queue an AI call
    const pending = new Set<number>();
    recipe.steps.forEach((step, idx) => {
      const { hasAmbiguous } = scaleText(step.instruction, multiplier);
      if (hasAmbiguous && multiplier !== 1) pending.add(idx);
    });

    if (pending.size === 0) {
      setAiPending(new Set());
      return;
    }

    setAiPending(new Set(pending));

    // Fire AI calls in parallel; update each step as its result arrives
    pending.forEach((idx) => {
      const originalInstruction = recipe.steps[idx].instruction;
      aiScaleText(originalInstruction, multiplier).then((aiResult) => {
        setScaledSteps((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], instruction: aiResult };
          return next;
        });
        setAiPending((prev) => {
          const next = new Set(prev);
          next.delete(idx);
          return next;
        });
      });
    });
  }, [recipe, multiplier]);

  // Seed scaled state when recipe first loads
  useEffect(() => {
    if (!recipe) return;
    setScaledIngredients(recipe.ingredients_used.map((ing) => scaleText(ing, 1).scaled));
    setScaledExtra((recipe.extra_ingredients_needed ?? []).map((ing) => scaleText(ing, 1).scaled));
    setScaledSteps(recipe.steps.map((s) => ({ ...s })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.id]);

  // Fetch recipe by UUID
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/recipes/${params.id}`, { signal: controller.signal })
      .then(async (r) => {
        // If the SW served this from cache the response still arrives here;
        // we detect "we were offline when we got it" via navigator.onLine.
        if (!navigator.onLine) setServedFromCache(true);
        return r.json();
      })
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setRecipe(data.recipe);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError("Failed to load recipe.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [params.id]);

  // Check Cache Storage to show "Saved for offline" badge
  useEffect(() => {
    if (typeof window === "undefined" || !("caches" in window)) return;
    const url = `/api/recipes/${params.id}`;
    window.caches.open("recipes-v1").then((cache) =>
      cache.match(url).then((hit) => {
        if (hit) setSavedForOffline(true);
      })
    ).catch(() => {});
  }, [params.id]);

  // Use scaled versions for display; fall back to originals while scaling
  const steps: RecipeStep[] = scaledSteps.length > 0 ? scaledSteps : (recipe?.steps ?? []);
  const stepCount = steps.length;
  const currentInstruction = steps[currentStep]?.instruction ?? "";

  const speakStep = useCallback((instruction: string, prefix = "") => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(true);
    const utt = new SpeechSynthesisUtterance(prefix + instruction);
    utt.rate = 0.95;
    utt.lang = "en-US";
    utt.onend = () => setSpeaking(false);
    utt.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utt);
  }, []);

  const goNext = useCallback(() => {
    setCurrentStep((s) => Math.min(s + 1, stepCount - 1));
  }, [stepCount]);

  const goPrev = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  // Auto-read aloud when cook mode is on and step changes
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    if (cookMode && currentInstruction) {
      const step = steps[currentStep];
      const prefix = currentStep === stepCount - 1
        ? "Final step. "
        : `Step ${step.step_number} of ${stepCount}. `;
      speakStep(currentInstruction, prefix);
    }
  }, [currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

  const startListening = useCallback(() => {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} }
    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.lang = "en-US";
    recognition.interimResults = false;
    setListening(true);
    recognition.onresult = (e: any) => {
      const t = e.results[0][0].transcript.toLowerCase().trim();
      if (t.includes("next")) goNext();
      else if (t.includes("back") || t.includes("previous")) goPrev();
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    window.speechSynthesis.cancel();
    recognition.start();
  }, [goNext, goPrev]);

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    const title = recipe ? `${recipe.title} — Sous` : "Recipe from Sous";
    const text = recipe
      ? `Check out this ${recipe.title} recipe on Sous:`
      : "Check out this recipe on Sous:";
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        setShared(true);
        setTimeout(() => setShared(false), 3000);
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 3000);
    } catch {
      prompt("Copy this link:", url);
    }
  }, [recipe]);

  const handleStartCooking = useCallback(() => {
    setCookMode(true);
    setCurrentStep(0);
    if (steps[0]) {
      const prefix = stepCount === 1 ? "Final step. " : `Step 1 of ${stepCount}. `;
      speakStep(steps[0].instruction, prefix);
    }
  }, [steps, stepCount, speakStep]);

  if (loading) {
    return (
      <div style={s.centered}>
        <div style={s.spinner} />
        <p style={{ color: "#888", marginTop: 16 }}>Loading recipe…</p>
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div style={s.centered}>
        <p style={{ color: "#FF6B6B", fontSize: 16 }}>{error || "Recipe not found."}</p>
        <a href="/" style={s.backLink}>← Back to Sous</a>
      </div>
    );
  }

  const progress = cookMode ? ((currentStep + 1) / stepCount) * 100 : 0;
  const isLastStep = currentStep === stepCount - 1;
  const showOfflineBanner = isOffline || servedFromCache;

  return (
    <div style={s.page}>

      {/* Offline / cached banners */}
      {showOfflineBanner && (
        <div style={s.offlineBanner}>
          📴 Offline – using saved recipe
        </div>
      )}
      {!showOfflineBanner && savedForOffline && (
        <div style={s.savedBanner}>
          ✅ Saved for offline
        </div>
      )}

      {/* ── Hero card (OG-image-ready layout) ── */}
      <div style={s.hero}>
        <div style={s.heroInner}>
          <div style={s.heroLogo}>🍳 Sous</div>

          <div style={s.heroBadges}>
            {recipe.difficulty && (
              <span style={{ ...s.badge, ...difficultyColor(recipe.difficulty) }}>
                {recipe.difficulty}
              </span>
            )}
            {recipe.total_time_minutes > 0 && (
              <span style={s.badge}>⏱ {recipe.total_time_minutes} min</span>
            )}
            {recipe.cuisine && (
              <span style={s.badge}>{recipe.cuisine}</span>
            )}
            <span style={s.badge}>📋 {stepCount} steps</span>
          </div>

          <h1 style={s.heroTitle}>{recipe.title}</h1>

          {recipe.description && (
            <p style={s.heroDesc}>{recipe.description}</p>
          )}

          {/* ── Serving multiplier control ── */}
          <div style={s.multiplierRow}>
            <span style={s.multiplierLabel}>Servings:</span>
            {MULTIPLIERS.map((m) => (
              <button
                key={m}
                style={{
                  ...s.multiplierBtn,
                  ...(multiplier === m ? s.multiplierBtnActive : {}),
                }}
                onClick={() => setMultiplier(m)}
                aria-pressed={multiplier === m}
              >
                {m === 0.5 ? "½×" : `${m}×`}
              </button>
            ))}
            {multiplier !== 1 && (
              <span style={s.multiplierNote}>
                {multiplier < 1 ? "Halved" : `${multiplier}× recipe`}
              </span>
            )}
          </div>

          <div style={s.heroActions}>
            {!cookMode ? (
              <button style={s.ctaBtn} onClick={handleStartCooking}>
                🍳 Cook this with Sous
              </button>
            ) : (
              <button style={{ ...s.ctaBtn, background: "#22c55e" }} onClick={() => {
                window.speechSynthesis?.cancel();
                setCookMode(false);
                setCurrentStep(0);
              }}>
                ✓ Cooking mode on
              </button>
            )}
            <button
              style={{ ...s.shareBtn, ...(shared ? s.shareBtnDone : {}) }}
              onClick={handleShare}
            >
              {shared ? "✓ Copied!" : "🔗 Share recipe"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Cook mode progress bar ── */}
      {cookMode && (
        <div style={s.progressTrack}>
          <div style={{ ...s.progressFill, width: `${progress}%` }} />
        </div>
      )}

      {/* ── Ingredients ── */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>Ingredients</h2>
        <ul style={s.ingList}>
          {scaledIngredients.map((ing, i) => (
            <li key={i} style={s.ingItem}>
              <span style={s.ingDot} />
              {ing}
            </li>
          ))}
        </ul>
        {scaledExtra.length > 0 && (
          <div style={s.extraBlock}>
            <p style={s.extraLabel}>You may also need:</p>
            <ul style={s.ingList}>
              {scaledExtra.map((ing, i) => (
                <li key={i} style={{ ...s.ingItem, color: "#666" }}>
                  <span style={{ ...s.ingDot, background: "#444" }} />
                  {ing}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Steps ── */}
      <div style={s.section}>
        <div style={s.stepsHeader}>
          <h2 style={s.sectionTitle}>
            {cookMode
              ? `Step ${currentStep + 1} of ${stepCount}`
              : `Method — ${stepCount} steps`}
          </h2>
          {cookMode && (
            <div style={s.listenRow}>
              <button
                style={{
                  ...s.listenBtn,
                  ...(listening ? s.listenBtnActive : {}),
                }}
                onClick={startListening}
                disabled={listening}
                title='Say "next" or "back"'
              >
                {listening ? "🎙 Listening…" : "🎙 Voice"}
              </button>
              <button
                style={s.speakBtn}
                onClick={() => speakStep(currentInstruction)}
                disabled={speaking}
              >
                {speaking ? "🔊…" : "🔊"}
              </button>
            </div>
          )}
        </div>

        {/* Cook mode: single active step card */}
        {cookMode && (
          <div style={s.activeStepCard}>
            <div style={s.activeStepNum}>Step {currentStep + 1}</div>
            <p style={s.activeStepText}>{currentInstruction}</p>
            {speaking && (
              <div style={s.speakingBadge}>
                <span style={s.speakingDot} /> Reading aloud…
              </div>
            )}
            {listening && (
              <div style={s.listeningBadge}>
                <span style={s.listeningDot} /> Listening for "next" or "back"…
              </div>
            )}
          </div>
        )}

        {/* Navigation (cook mode) */}
        {cookMode && (
          <div style={s.navRow}>
            <button
              style={{ ...s.navBtn, opacity: currentStep === 0 ? 0.3 : 1 }}
              onClick={goPrev}
              disabled={currentStep === 0}
            >
              ← Prev
            </button>
            {!isLastStep ? (
              <button style={s.nextBtn} onClick={goNext}>
                Next →
              </button>
            ) : (
              <button
                style={{ ...s.nextBtn, background: "#22c55e" }}
                onClick={() => { window.speechSynthesis?.cancel(); setCookMode(false); }}
              >
                🎉 Done!
              </button>
            )}
          </div>
        )}

        {/* All steps — read-only list (always shown) or step pills in cook mode */}
        {!cookMode ? (
          <ol style={s.stepList}>
            {steps.map((step, i) => (
              <li key={step.step_number} style={s.stepListItem}>
                <div style={s.stepListNum}>{step.step_number}</div>
                <p style={s.stepListText}>
                  {step.instruction}
                  {aiPending.has(i) && (
                    <span style={s.aiScalingBadge}>✦ scaling…</span>
                  )}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <div style={s.stepPills}>
            {steps.map((step, i) => (
              <button
                key={step.step_number}
                style={{
                  ...s.stepPill,
                  background:
                    i === currentStep ? "#FF6B35"
                    : i < currentStep ? "#1a2a1a"
                    : "#111",
                  color:
                    i === currentStep ? "#fff"
                    : i < currentStep ? "#4ade80"
                    : "#555",
                  border:
                    i === currentStep ? "none"
                    : i < currentStep ? "1px solid #22c55e44"
                    : "1px solid #222",
                }}
                onClick={() => setCurrentStep(i)}
                title={`Step ${i + 1}`}
              >
                {i < currentStep ? "✓" : i + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer CTA ── */}
      <div style={s.footer}>
        <p style={s.footerText}>Made with Sous — the hands-free kitchen assistant</p>
        <a href="/" style={s.footerLink}>Try Sous with your own ingredients →</a>
      </div>
    </div>
  );
}

function difficultyColor(d: string): React.CSSProperties {
  const l = d.toLowerCase();
  if (l === "easy") return { background: "#0d2b0d", color: "#4ade80", borderColor: "#22c55e44" };
  if (l === "hard") return { background: "#2b0d0d", color: "#f87171", borderColor: "#ef444444" };
  return { background: "#2b1f0d", color: "#fbbf24", borderColor: "#f59e0b44" };
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100dvh",
    background: "#0a0a0a",
    color: "#fff",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    paddingBottom: 80,
  },
  centered: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "#0a0a0a",
    color: "#fff",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    gap: 12,
  },
  spinner: {
    width: 36,
    height: 36,
    border: "3px solid #222",
    borderTop: "3px solid #FF6B35",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  backLink: {
    color: "#FF6B35",
    textDecoration: "none",
    fontSize: 15,
  },

  // ── Hero ──────────────────────────────────────────────
  hero: {
    background: "linear-gradient(160deg, #1a0e00 0%, #0f0f0f 60%, #0a0a0a 100%)",
    borderBottom: "1px solid #1e1400",
    padding: "0 0 32px",
  },
  heroInner: {
    maxWidth: 680,
    margin: "0 auto",
    padding: "32px 24px 0",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  heroLogo: {
    fontSize: 15,
    fontWeight: 800,
    color: "#FF6B35",
    letterSpacing: 0.5,
  },
  heroBadges: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  badge: {
    background: "#1a1a1a",
    color: "#888",
    border: "1px solid #2a2a2a",
    borderRadius: 20,
    padding: "4px 12px",
    fontSize: 12,
    fontWeight: 600,
  },
  heroTitle: {
    fontSize: "clamp(28px, 6vw, 48px)",
    fontWeight: 900,
    margin: 0,
    lineHeight: 1.1,
    letterSpacing: -0.5,
    color: "#fff",
  },
  heroDesc: {
    color: "#aaa",
    fontSize: 16,
    lineHeight: 1.6,
    margin: 0,
    maxWidth: 560,
  },
  heroActions: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
  },
  ctaBtn: {
    background: "#FF6B35",
    color: "#fff",
    border: "none",
    borderRadius: 14,
    padding: "16px 28px",
    fontSize: 17,
    fontWeight: 800,
    cursor: "pointer",
    letterSpacing: 0.2,
    flex: "1 1 200px",
    transition: "opacity 0.2s",
  },
  shareBtn: {
    background: "#1a1a1a",
    color: "#aaa",
    border: "1px solid #333",
    borderRadius: 14,
    padding: "16px 24px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    flex: "0 0 auto",
    transition: "all 0.2s",
  },
  shareBtnDone: {
    background: "#0d2b0d",
    color: "#4ade80",
    borderColor: "#22c55e44",
  },

  // ── Progress bar ──────────────────────────────────────
  progressTrack: {
    height: 4,
    background: "#1a1a1a",
    width: "100%",
  },
  progressFill: {
    height: "100%",
    background: "#FF6B35",
    transition: "width 0.4s ease",
  },

  // ── Sections ──────────────────────────────────────────
  section: {
    maxWidth: 680,
    margin: "0 auto",
    padding: "32px 24px",
    borderBottom: "1px solid #111",
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 800,
    margin: "0 0 20px",
    color: "#fff",
  },
  stepsHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    gap: 12,
    flexWrap: "wrap",
  },

  // ── Ingredients ───────────────────────────────────────
  ingList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  ingItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    color: "#ccc",
    fontSize: 15,
    lineHeight: 1.45,
  },
  ingDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#FF6B35",
    flexShrink: 0,
  },
  extraBlock: {
    marginTop: 20,
    paddingTop: 20,
    borderTop: "1px solid #1a1a1a",
  },
  extraLabel: {
    color: "#555",
    fontSize: 13,
    margin: "0 0 12px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // ── Steps (read-only list) ────────────────────────────
  stepList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  stepListItem: {
    display: "flex",
    gap: 16,
    alignItems: "flex-start",
  },
  stepListNum: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    color: "#FF6B35",
    fontSize: 13,
    fontWeight: 800,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  stepListText: {
    color: "#ccc",
    fontSize: 15,
    lineHeight: 1.65,
    margin: 0,
    paddingTop: 4,
  },

  // ── Cook mode: active step ────────────────────────────
  activeStepCard: {
    background: "#111",
    border: "1px solid #2a2a2a",
    borderRadius: 20,
    padding: "28px 24px",
    marginBottom: 20,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  activeStepNum: {
    color: "#FF6B35",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  activeStepText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 1.5,
    margin: 0,
  },
  speakingBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: 600,
  },
  speakingDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#94a3b8",
    display: "inline-block",
    animation: "pulse 1.2s ease-in-out infinite",
  },
  listeningBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: "#86efac",
    fontSize: 13,
    fontWeight: 600,
  },
  listeningDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#22c55e",
    display: "inline-block",
    boxShadow: "0 0 0 3px #22c55e33",
    animation: "pulse 1.2s ease-in-out infinite",
  },

  // ── Cook mode controls ────────────────────────────────
  listenRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexShrink: 0,
  },
  listenBtn: {
    background: "#1a1a1a",
    color: "#888",
    border: "1px solid #333",
    borderRadius: 10,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  listenBtnActive: {
    background: "#0d2b0d",
    color: "#4ade80",
    borderColor: "#22c55e44",
  },
  speakBtn: {
    background: "#1a1a1a",
    color: "#888",
    border: "1px solid #333",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 16,
    cursor: "pointer",
  },
  navRow: {
    display: "flex",
    gap: 12,
    marginBottom: 24,
  },
  navBtn: {
    flex: 1,
    background: "#1a1a1a",
    color: "#888",
    border: "1px solid #333",
    borderRadius: 14,
    padding: "16px 20px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  nextBtn: {
    flex: 2,
    background: "#FF6B35",
    color: "#fff",
    border: "none",
    borderRadius: 14,
    padding: "16px 20px",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
    letterSpacing: 0.3,
  },
  stepPills: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  stepPill: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Offline banner ────────────────────────────────────
  offlineBanner: {
    background: "#2a1a00",
    color: "#fbbf24",
    border: "1px solid #f59e0b44",
    padding: "10px 20px",
    fontSize: 13,
    fontWeight: 700,
    textAlign: "center" as const,
    letterSpacing: 0.2,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  savedBanner: {
    background: "#0d2b0d",
    color: "#4ade80",
    border: "1px solid #22c55e44",
    padding: "8px 20px",
    fontSize: 12,
    fontWeight: 700,
    textAlign: "center" as const,
    letterSpacing: 0.2,
    width: "100%",
    boxSizing: "border-box" as const,
  },

  // ── Multiplier control ────────────────────────────────
  multiplierRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap" as const,
  },
  multiplierLabel: {
    color: "#888",
    fontSize: 13,
    fontWeight: 600,
    marginRight: 2,
  },
  multiplierBtn: {
    background: "#1a1a1a",
    color: "#888",
    border: "1px solid #2a2a2a",
    borderRadius: 10,
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  multiplierBtnActive: {
    background: "#2a1400",
    color: "#FF6B35",
    border: "1px solid #FF6B3566",
  },
  multiplierNote: {
    color: "#FF6B35",
    fontSize: 12,
    fontWeight: 700,
    marginLeft: 4,
    opacity: 0.85,
  },
  aiScalingBadge: {
    marginLeft: 8,
    color: "#555",
    fontSize: 11,
    fontWeight: 600,
    fontStyle: "italic" as const,
    verticalAlign: "middle",
  },

  // ── Footer ────────────────────────────────────────────
  footer: {
    maxWidth: 680,
    margin: "0 auto",
    padding: "40px 24px 60px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    textAlign: "center",
  },
  footerText: {
    color: "#333",
    fontSize: 13,
    margin: 0,
  },
  footerLink: {
    color: "#FF6B35",
    textDecoration: "none",
    fontSize: 15,
    fontWeight: 700,
  },
};