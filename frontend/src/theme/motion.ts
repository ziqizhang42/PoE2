export interface MotionPreference {
  prefersReducedMotion(): boolean;
}

export function browserMotionPreference(): MotionPreference {
  const query =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

  return {
    prefersReducedMotion: () => query?.matches ?? false,
  };
}
