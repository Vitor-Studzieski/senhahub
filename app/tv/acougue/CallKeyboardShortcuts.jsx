"use client";

import { useEffect } from "react";

const CALL_SHORTCUTS = Object.freeze({
  F8: "again",
  F9: "next",
  F13: "again",
  F14: "next"
});

export default function CallKeyboardShortcuts() {
  useEffect(() => {
    function handleKeydown(event) {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target?.isContentEditable || event.target?.closest?.("input, textarea, select, [contenteditable='true'], [role='textbox'], [role='searchbox']")) return;

      const key = String(event.code || event.key || "").toUpperCase();
      const action = CALL_SHORTCUTS[key] || CALL_SHORTCUTS[String(event.key || "").toUpperCase()];
      if (!action) return;

      event.preventDefault();
      const button = document.querySelector(`[data-tv-call-action="${action}"]`);
      if (!button || button.disabled || button.hidden) return;
      button.click();
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  return null;
}
