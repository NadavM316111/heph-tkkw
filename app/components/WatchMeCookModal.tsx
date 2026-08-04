"use client";

import { useState } from "react";

interface WatchMeCookModalProps {
  recipeName: string;
  stepCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function WatchMeCookModal({
  recipeName,
  stepCount,
  onConfirm,
  onCancel,
}: WatchMeCookModalProps) {
  const [understood, setUnderstood] = useState(false);

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        {/* Icon */}
        <div style={styles.iconRow}>
          <span style={styles.icon}>👁️</span>
        </div>

        {/* Title */}
        <h2 style={styles.title}>Watch Me Cook</h2>
        <p style={styles.subtitle}>
          AI will watch you via your camera and guide you through each step of{" "}
          <strong style={{ color: "#fff" }}>{recipeName}</strong>.
        </p>

        {/* How it works */}
        <div style={styles.infoBlock}>
          <p style={styles.infoHeading}>How it works</p>
          <ul style={styles.infoList}>
            <li style={styles.infoItem}>
              <span style={styles.infoEmoji}>📷</span>
              Your camera stays on throughout cooking
            </li>
            <li style={styles.infoItem}>
              <span style={styles.infoEmoji}>🤖</span>
              AI checks your progress at each of the {stepCount} steps
            </li>
            <li style={styles.infoItem}>
              <span style={styles.infoEmoji}>🎙️</span>
              Instructions are read aloud — say "next" to advance
            </li>
            <li style={styles.infoItem}>
              <span style={styles.infoEmoji}>✅</span>
              AI confirms you're ready before moving on
            </li>
          </ul>
        </div>

        {/* Credits warning */}
        <div style={styles.warningBlock}>
          <div style={styles.warningHeader}>
            <span style={styles.warningIcon}>⚠️</span>
            <span style={styles.warningTitle}>AI credits usage</span>
          </div>
          <p style={styles.warningText}>
            This feature sends a photo to the AI at every step. A{" "}
            {stepCount}-step recipe will use approximately{" "}
            <strong style={{ color: "#FBBF24" }}>{stepCount} AI image credits</strong>.
            Standard cooking sessions use no credits.
          </p>
        </div>

        {/* Privacy note */}
        <div style={styles.privacyBlock}>
          <span style={styles.privacyIcon}>🔒</span>
          <p style={styles.privacyText}>
            Photos are sent to the AI for analysis only. They are not stored
            beyond what your normal uploads already save.
          </p>
        </div>

        {/* Checkbox acknowledgement */}
        <label style={styles.checkLabel}>
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            style={styles.checkbox}
          />
          <span style={styles.checkText}>
            I understand the camera will stay on and AI credits will be used
          </span>
        </label>

        {/* Actions */}
        <div style={styles.actions}>
          <button
            style={{
              ...styles.startBtn,
              ...(understood ? {} : styles.startBtnDisabled),
            }}
            onClick={onConfirm}
            disabled={!understood}
          >
            👁️ Start Watching
          </button>
          <button style={styles.cancelBtn} onClick={onCancel}>
            Cancel — use standard mode
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.85)",
    backdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "20px 16px",
  },
  modal: {
    background: "#1a1a1a",
    borderRadius: 24,
    padding: "32px 28px 28px",
    width: "100%",
    maxWidth: 420,
    maxHeight: "90dvh",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 18,
    boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
    border: "1px solid #2a2a2a",
  },

  // Header
  iconRow: {
    display: "flex",
    justifyContent: "center",
  },
  icon: {
    fontSize: 52,
    lineHeight: 1,
  },
  title: {
    color: "#fff",
    fontSize: 26,
    fontWeight: 800,
    margin: 0,
    textAlign: "center",
  },
  subtitle: {
    color: "#aaa",
    fontSize: 15,
    lineHeight: 1.55,
    margin: 0,
    textAlign: "center",
  },

  // How it works
  infoBlock: {
    background: "#111",
    borderRadius: 16,
    padding: "16px 18px",
    border: "1px solid #222",
  },
  infoHeading: {
    color: "#888",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    margin: "0 0 12px",
  },
  infoList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  infoItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    color: "#ccc",
    fontSize: 14,
    lineHeight: 1.45,
  },
  infoEmoji: {
    fontSize: 16,
    flexShrink: 0,
    marginTop: 1,
  },

  // Credits warning
  warningBlock: {
    background: "#1f1500",
    borderRadius: 14,
    padding: "14px 16px",
    border: "1px solid #FBBF2433",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  warningHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  warningIcon: {
    fontSize: 18,
    flexShrink: 0,
  },
  warningTitle: {
    color: "#FBBF24",
    fontSize: 14,
    fontWeight: 700,
  },
  warningText: {
    color: "#d4a84b",
    fontSize: 13,
    lineHeight: 1.55,
    margin: 0,
  },

  // Privacy note
  privacyBlock: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    background: "#111",
    borderRadius: 12,
    padding: "12px 14px",
    border: "1px solid #222",
  },
  privacyIcon: {
    fontSize: 16,
    flexShrink: 0,
    marginTop: 1,
  },
  privacyText: {
    color: "#666",
    fontSize: 12,
    lineHeight: 1.55,
    margin: 0,
  },

  // Checkbox
  checkLabel: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    cursor: "pointer",
    padding: "4px 0",
  },
  checkbox: {
    width: 18,
    height: 18,
    flexShrink: 0,
    marginTop: 2,
    accentColor: "#FF6B35",
    cursor: "pointer",
  },
  checkText: {
    color: "#bbb",
    fontSize: 14,
    lineHeight: 1.5,
  },

  // Buttons
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 4,
  },
  startBtn: {
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
  startBtnDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  cancelBtn: {
    background: "transparent",
    color: "#666",
    border: "none",
    borderRadius: 12,
    padding: "12px 24px",
    fontSize: 14,
    cursor: "pointer",
    width: "100%",
    textAlign: "center",
  },
};