import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * A pop-up that lives on `document.body`, fixed next to its trigger, so no stacking context or
 * `overflow: hidden` in the app can cover or clip it (same approach as the guide's Hint card).
 * It follows the anchor on resize and scroll, closes on Esc and on a mouse-down outside both the
 * pop-up and the anchor (the pop-up is no longer a DOM child of its trigger, so callers must not
 * rely on `contains()` against their own container).
 */
export function AnchoredPopover({
  anchor,
  onClose,
  align = "start",
  placement = "below",
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** `start` lines the left edges up, `end` the right edges. */
  align?: "start" | "end";
  placement?: "below" | "above";
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const s: CSSProperties = align === "end" ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) };
      if (placement === "above") s.bottom = window.innerHeight - r.top + 10;
      else s.top = r.bottom + 6;
      setStyle(s);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, align, placement]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !anchor.current?.contains(t)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [anchor]);

  return createPortal(
    <div ref={box} className="anchored-pop" style={style ?? { visibility: "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}
