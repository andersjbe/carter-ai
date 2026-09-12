export type Theme = "light" | "dark";

const STORAGE_KEY = "carter.theme";

export function getStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // Ignore private-mode / blocked storage.
  }
  return null;
}

export function getPreferredTheme(): Theme {
  const stored = getStoredTheme();
  if (stored) return stored;
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore private-mode / blocked storage.
  }
}

export function toggleTheme(): Theme {
  const next: Theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

export function initTheme(): Theme {
  const theme = getPreferredTheme();
  applyTheme(theme);
  return theme;
}
