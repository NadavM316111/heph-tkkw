export interface WatchMeCookSession {
  isActive: boolean;
  startTime: number;
  lastCheckTime: number;
  isSpeaking: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
  streamRef: MediaStream | null;
  autoCheckEnabled: boolean;
}