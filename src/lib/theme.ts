export type ThemePreferenceValue = "LIGHT" | "DARK";

export const themeCookieName = "theme";
const oneYearSeconds = 60 * 60 * 24 * 365;

export const resolveThemePreference = (value?: string | null): ThemePreferenceValue =>
  value === "DARK" || value?.toLowerCase() === "dark" ? "DARK" : "LIGHT";

export const themeClassName = (theme: ThemePreferenceValue) => (theme === "DARK" ? "dark" : "");

export const applyThemePreference = (theme: ThemePreferenceValue) => {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (theme === "DARK") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
};

export const persistThemeCookie = (theme: ThemePreferenceValue) => {
  if (typeof document === "undefined") {
    return;
  }
  const value = theme === "DARK" ? "dark" : "light";
  document.cookie = `${themeCookieName}=${value}; path=/; max-age=${oneYearSeconds}; samesite=lax`;
};
