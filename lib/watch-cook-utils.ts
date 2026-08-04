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