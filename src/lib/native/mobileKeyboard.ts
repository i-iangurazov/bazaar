import type { KeyboardEvent } from "react";
import { getNativePlatform, isNativeApp } from "./platform";

export function hasMobileKeyboard() {
  if (isNativeApp()) return getNativePlatform() === "ios";
  return window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false;
}

/** The auth forms opt in via enterKeyHint. Leave regular Enter and IME handling to the browser. */
export function moveToNextAuthField(event: KeyboardEvent<HTMLFormElement>) {
  const field = event.target;
  if (event.key !== "Enter" || event.defaultPrevented || event.repeat ||
      event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      !(field instanceof HTMLInputElement) || field.getAttribute("enterkeyhint") !== "next" ||
      field.inputMode === "none" || !hasMobileKeyboard()) return;

  const form = event.currentTarget;
  const fields = Array.from(form.querySelectorAll<HTMLInputElement>("input[enterkeyhint]"));
  const index = fields.indexOf(field);
  if (index === -1) return;
  const next = fields.slice(index + 1).find(input => input.form === form &&
    !input.matches(":disabled, [readonly]") && input.inputMode !== "none" &&
    input.tabIndex >= 0 && input.getClientRects().length > 0);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (document.activeElement === next) event.preventDefault();
}
