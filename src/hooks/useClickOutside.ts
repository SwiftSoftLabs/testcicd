import { useEffect } from "react";

export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  handler: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;

    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }

      const ownLayer = ref.current.closest("[data-modal-layer]");
      const eventTarget = event.target;
      const eventLayer =
        eventTarget instanceof Element
          ? eventTarget.closest("[data-modal-layer]")
          : null;

      if (ownLayer && eventLayer && ownLayer !== eventLayer) {
        return;
      }

      handler();
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [enabled, ref, handler]);
}
