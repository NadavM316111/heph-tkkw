export interface RecipeStep {
  step_number: number;
  instruction: string;
}

export interface Recipe {
  id?: number;
  title: string;
  description?: string;
  ingredients_used: string[];
  extra_ingredients_needed?: string[];
  steps: RecipeStep[];
  total_time_minutes?: number;
  difficulty?: string;
  cuisine?: string;
}

export interface WatchMeCookSession {
  isActive: boolean;
  startTime: number;
  lastCheckTime: number;
  isSpeaking: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
  streamRef: MediaStream | null;
  autoCheckEnabled: boolean;
}