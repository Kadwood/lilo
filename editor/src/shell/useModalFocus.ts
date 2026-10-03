import { useEffect, useRef } from "react";

/**
 * Focus management for a modal dialog: focus moves into it when it opens (so Esc and Tab work from
 * the keyboard) and goes back to whatever had it when it closes. Put the ref on the dialog element
 * and give that element `tabIndex={-1}`.
 */
export function useModalFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const before = document.activeElement;
    // a control inside may already have asked for focus (autoFocus); only claim it if nothing did
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus();
    return () => {
      if (before instanceof HTMLElement && document.contains(before)) before.focus();
    };
  }, []);
  return ref;
}
