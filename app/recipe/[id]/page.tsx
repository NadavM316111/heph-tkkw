"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useWatchMeCook } from "../../../hooks/useWatchMeCook";
import WatchMeCookModal from "../../components/WatchMeCookModal";
import WatchMeCookOverlay from "../../components/WatchMeCookOverlay";

interface RecipeStep {
  step_number: number;
  instruction: string;
}

interface Recipe {
  id: number;
  title: string;
  description: string;
  ingredients_used: string[];
  extra_ingredients_needed: string[];
  steps: RecipeStep[];
  total_time_minutes: number;
  difficulty: string;
  cuisine: string;
}

export default function RecipePage({ params }: { params: { id: string } }) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentStep, setCurrentStep] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [showWatchModal, setShowWatchModal] = useState(false);
  const [watchActive, setWatchActive] = useState(false);
  const recognitionRef = useRef<any>(null);

  const { session, videoRef, startSession, stopSession, setWatchStep } =
    useWatchMeCook();

  // Fetch recipe
  useEffect(() => {
    fetch(`/api/recipes/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setRecipe(data.recipe);
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load recipe.");
        setLoading(false);
      });
  }, [params.id]);

  const steps: RecipeStep[] = recipe?.steps ?? [];
  const stepCount = steps.length;
  const currentInstruction = steps[currentStep]?.instruction ?? "";

  // Speak a step aloud
  const speakStep = useCallback(
    (instruction: string) => {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      setSpeaking(true);
      const utt = new SpeechSynthesisUtterance(instruction);
      utt.rate = 0.95;
      utt.lang = "en-US";
      utt.onend = () => setSpeaking(false);
      utt.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utt);
    },
    []
  );

  // Speak current step when it changes (after first render)
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    if (currentInstruction) speakStep(currentInstruction);
    if (watchActive) setWatchStep(currentStep);
  }, [currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

  const goNext = useCallback(() => {
    setCurrentStep((s) => Math.min(s + 1, stepCount - 1));
  }, [stepCount]);

  const goPrev = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  // Voice recognition for "next" command
  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.lang = "en-US";
    recognition.interimResults = false;

    setListening(true);
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript.toLowerCase().trim();
      if (transcript.includes("next")) {
        goNext();
      }
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    // Stop speech synthesis before listening so it doesn't hear itself
    window.speechSynthesis.cancel();
    recognition.start();
  }, [goNext]);

  // Watch Me Cook handlers
  const handleWatchConfirm = useCallback(async () => {
    setShowWatchModal(false);
    setWatchActive(true);
    await startSession(currentStep);
    // Speak the current step instruction once watching starts
    if (currentInstruction) speakStep(currentInstruction);
  }, [currentStep, currentInstruction, startSession, speakStep]);

  const handleWatchStop = useCallback(() => {
    stopSession();
    setWatchActive(false);
  }, [stopSession]);

  // Hidden video element for the hook's camera stream
  const hiddenVideoStyle: React.CSSProperties = {
    position: "fixed",
    top: -9999,
    left: -9999,
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: "none",
  };

  if (loading) {
    return (
      <div style={styles.centered}>
        <div style={styles.spinner} />
        <p style={{ color: "#888", marginTop: 16 }}>Loading recipe…</p>
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div style={styles.centered}>
        <p style={{ color: "#FF6B6B", fontSize: 16 }}>{error || "Recipe not found."}</p>
        <a href="/" style={styles.backLink}>
          ← Back to Sous
        </a>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Hidden video element consumed by useWatchMeCook */}
      <video ref={videoRef} style={hiddenVideoStyle} autoPlay playsInline muted />

      {/* ── Header ── */}
      <div style={styles.header}>
        <a href="/" style={styles.backBtn}>
          ← Back
        </a>

        <div style={styles.headerMeta}>
          {recipe.total_time_minutes > 0 && (
            <span style={styles.metaBadge}>⏱ {recipe.total_time_minutes} min</span>
          )}
          {recipe.difficulty && (
            <span style={styles.metaBadge}>{recipe.difficulty}</span>
          )}
          {recipe.cuisine && (
            <span style={styles.metaBadge}>{recipe.cuisine}</span>
          )}
        </div>

        <h1 style={styles.title}>{recipe.title}</h1>
        {recipe.description && (
          <p style={styles.description}>{recipe.description}</p>
        )}

        {/* Watch Me Cook button */}
        <button
          style={{
            ...styles.watchBtn,
            ...(watchActive ? styles.watchBtnActive : {}),
          }}
          onClick={() => {
            if (watchActive) {
              handleWatchStop();
            } else {
              setShowWatchModal(true);
            }
          }}
        >
          {watchActive ? "⏹ Stop Watching" : "👁️ Watch Me Cook"}
        </button>
      </div>

      {/* ── Ingredients ── */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Ingredients</h2>
        <ul style={styles.ingredientList}>
          {recipe.ingredients_used.map((ing, i) => (
            <li key={i} style={styles.ingredientItem}>
              <span style={styles.ingredientDot}>•</span>
              {ing}
            </li>
          ))}
        </ul>
        {recipe.extra_ingredients_needed?.length > 0 && (
          <>
            <p style={styles.extraLabel}>You may also need:</p>
            <ul style={styles.ingredientList}>
              {recipe.extra_ingredients_needed.map((ing, i) => (
                <li key={i} style={{ ...styles.ingredientItem, color: "#888" }}>
                  <span style={styles.ingredientDot}>•</span>
                  {ing}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ── Steps ── */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>
          Step {currentStep + 1} of {stepCount}
        </h2>

        <div style={styles.stepCard}>
          <p style={styles.stepNumber}>Step {currentStep + 1}</p>
          <p style={styles.stepInstruction}>{currentInstruction}</p>

          {/* Speak button */}
          <button
            style={{
              ...styles.speakBtn,
              opacity: speaking ? 0.6 : 1,
            }}
            onClick={() => speakStep(currentInstruction)}
            disabled={speaking}
          >
            {speaking ? "🔊 Speaking…" : "🔊 Read aloud"}
          </button>
        </div>

        {/* Voice listener */}
        <button
          style={{
            ...styles.listenBtn,
            background: listening ? "#1a3a1a" : "#111",
            borderColor: listening ? "#4CAF50" : "#333",
            color: listening ? "#4CAF50" : "#888",
          }}
          onClick={startListening}
          disabled={listening}
        >
          {listening ? "🎙️ Listening for "next"…" : "🎙️ Say "next" to advance"}
        </button>

        {/* Watch Me Cook AI check feedback */}
        {watchActive && session.lastCheck && (
          <div style={styles.aiCheckCard}>
            <p style={styles.aiCheckObs}>{session.lastCheck.observation}</p>
            <p style={styles.aiCheckEnc}>{session.lastCheck.encouragement}</p>
            {session.lastCheck.ready && (
              <p style={styles.aiCheckReady}>✅ Looks ready to move on!</p>
            )}
          </div>
        )}

        {/* Navigation */}
        <div style={styles.navRow}>
          <button
            style={{
              ...styles.navBtn,
              opacity: currentStep === 0 ? 0.35 : 1,
            }}
            onClick={goPrev}
            disabled={currentStep === 0}
          >
            ← Previous
          </button>

          {currentStep < stepCount - 1 ? (
            <button style={styles.nextBtn} onClick={goNext}>
              Next Step →
            </button>
          ) : (
            <button style={{ ...styles.nextBtn, background: "#4CAF50" }}>
              🎉 Done!
            </button>
          )}
        </div>

        {/* All steps list (collapsed view) */}
        <div style={styles.allSteps}>
          {steps.map((step, i) => (
            <button
              key={step.step_number}
              style={{
                ...styles.stepPill,
                background: i === currentStep ? "#FF6B35" : i < currentStep ? "#2a2a2a" : "#111",
                color: i === currentStep ? "#fff" : i < currentStep ? "#666" : "#aaa",
                border: i === currentStep ? "none" : "1px solid #222",
              }}
              onClick={() => setCurrentStep(i)}
            >
              {i < currentStep ? "✓" : i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* ── Watch Me Cook Modal ── */}
      {showWatchModal && (
        <WatchMeCookModal
          recipeName={recipe.title}
          stepCount={stepCount}
          onConfirm={handleWatchConfirm}
          onCancel={() => setShowWatchModal(false)}
        />
      )}

      {/* ── Watch Me Cook Overlay ── */}
      {watchActive && (
        <WatchMeCookOverlay
          onStop={handleWatchStop}
          stepInstruction={currentInstruction}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100dvh",
    background: "#0a0a0a",
    color: "#fff",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    paddingBottom: 120,
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
    marginTop: 16,
    fontSize: 15,
  },

  // Header
  header: {
    padding: "32px 20px 24px",
    borderBottom: "1px solid #1a1a1a",
  },
  backBtn: {
    display: "inline-block",
    color: "#888",
    textDecoration: "none",
    fontSize: 14,
    marginBottom: 16,
  },
  headerMeta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  metaBadge: {
    background: "#1a1a1a",
    color: "#888",
    borderRadius: 20,
    padding: "4px 12px",
    fontSize: 12,
    border: "1px solid #222",
  },
  title: {
    fontSize: 28,
    fontWeight: 800,
    margin: "0 0 8px",
    lineHeight: 1.2,
  },
  description: {
    color: "#888",
    fontSize: 15,
    lineHeight: 1.55,
    margin: "0 0 20px",
  },

  // Watch Me Cook button
  watchBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: "#1a1a1a",
    color: "#FF6B35",
    border: "1px solid #FF6B3544",
    borderRadius: 14,
    padding: "12px 20px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: 0.2,
  },
  watchBtnActive: {
    background: "#1a0a0a",
    color: "#FF6B6B",
    borderColor: "#FF6B6B44",
  },

  // Sections
  section: {
    padding: "24px 20px",
    borderBottom: "1px solid #1a1a1a",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 700,
    margin: "0 0 16px",
    color: "#fff",
  },

  // Ingredients
  ingredientList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  ingredientItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    color: "#ccc",
    fontSize: 15,
    lineHeight: 1.45,
  },
  ingredientDot: {
    color: "#FF6B35",
    flexShrink: 0,
    marginTop: 1,
  },
  extraLabel: {
    color: "#666",
    fontSize: 13,
    margin: "16px 0 8px",
  },

  // Steps
  stepCard: {
    background: "#111",
    borderRadius: 20,
    padding: "24px 20px",
    border: "1px solid #222",
    marginBottom: 16,
  },
  stepNumber: {
    color: "#FF6B35",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    margin: "0 0 10px",
  },
  stepInstruction: {
    color: "#fff",
    fontSize: 18,
    lineHeight: 1.6,
    margin: "0 0 18px",
  },
  speakBtn: {
    background: "#1a1a1a",
    color: "#aaa",
    border: "1px solid #333",
    borderRadius: 12,
    padding: "10px 16px",
    fontSize: 14,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },

  // Listen button
  listenBtn: {
    width: "100%",
    border: "1px solid",
    borderRadius: 14,
    padding: "14px 20px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: 16,
    textAlign: "center",
  },

  // AI check card
  aiCheckCard: {
    background: "#0d1f0d",
    border: "1px solid #4CAF5044",
    borderRadius: 16,
    padding: "16px 18px",
    marginBottom: 16,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  aiCheckObs: {
    color: "#ccc",
    fontSize: 14,
    margin: 0,
    lineHeight: 1.5,
  },
  aiCheckEnc: {
    color: "#4CAF50",
    fontSize: 13,
    margin: 0,
    fontWeight: 600,
  },
  aiCheckReady: {
    color: "#4CAF50",
    fontSize: 14,
    fontWeight: 700,
    margin: 0,
  },

  // Navigation
  navRow: {
    display: "flex",
    gap: 12,
    marginBottom: 24,
  },
  navBtn: {
    flex: 1,
    background: "#111",
    color: "#888",
    border: "1px solid #222",
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
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: 0.3,
  },

  // Step pills
  allSteps: {
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
};