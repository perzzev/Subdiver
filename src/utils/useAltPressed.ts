import { useEffect, useState } from "react";

/**
 * Track whether the Alt (Option on macOS) modifier is currently held. Exposed
 * also as `[data-alt-mode]` on document.body so CSS can react without re-renders.
 */
export function useAltPressed(): boolean {
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    function handleDown(event: KeyboardEvent) {
      if (event.altKey && !pressed) setPressed(true);
    }
    function handleUp(event: KeyboardEvent) {
      if (!event.altKey && pressed) setPressed(false);
    }
    function handleBlur() {
      if (pressed) setPressed(false);
    }
    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [pressed]);

  useEffect(() => {
    if (pressed) document.body.setAttribute("data-alt-mode", "");
    else document.body.removeAttribute("data-alt-mode");
  }, [pressed]);

  return pressed;
}
