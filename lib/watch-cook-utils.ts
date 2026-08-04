import type { Recipe } from "../types/cooking";

/**
 * Builds an AI vision prompt for the "watch me cook" pan-checking feature.
 * @param recipe  The recipe being cooked.
 * @param stepIndex  Zero-based index of the current step.
 * @param mode  'auto' = periodic background check; 'manual' = user explicitly asked.
 */
export function buildWatchPrompt(
  recipe: Recipe,
  stepIndex: number,
  mode: "auto" | "manual"
): string {
  const step = recipe.steps[stepIndex];
  const stepNumber = step ? step.step_number : stepIndex + 1;
  const instruction = step ? step.instruction : "(unknown step)";
  const totalSteps = recipe.steps.length;

  const context = [
    `Recipe: "${recipe.title}"`,
    `Current step ${stepNumber} of ${totalSteps}: "${instruction}"`,
  ].join("\n");

  const taskIntro =
    mode === "auto"
      ? "You are periodically checking in on a home cook. Briefly assess what you see."
      : "The cook has asked for your assessment. Give a clear, direct answer.";

  return [
    taskIntro,
    "",
    context,
    "",
    "Look at the photo and answer ALL of the following:",
    "1. Is the cook on track with the current step? (yes / not yet / something looks wrong)",
    "2. In one short sentence, describe what you actually see happening in the pan or on the counter.",
    "3. Is it safe to move on to the next step? (yes / no / almost — wait a bit longer)",
    "4. Any brief tip or warning the cook should hear right now? (keep it under 15 words, or say 'none')",
    "",
    "Reply in exactly this JSON format with no markdown fencing:",
    '{ "onTrack": "yes|not yet|something looks wrong", "observation": "...", "readyForNext": "yes|no|almost", "tip": "..." }',
  ].join("\n");
}

/**
 * Captures a single frame from a playing HTMLVideoElement and returns it
 * as a base64-encoded JPEG data URL suitable for display or AI vision calls.
 */
export function captureFrameFromVideo(videoEl: HTMLVideoElement): string {
  const width = videoEl.videoWidth || videoEl.clientWidth || 640;
  const height = videoEl.videoHeight || videoEl.clientHeight || 480;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get 2D context from offscreen canvas");
  }

  ctx.drawImage(videoEl, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.92);
}