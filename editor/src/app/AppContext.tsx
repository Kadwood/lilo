import { createContext, useContext } from "react";

/** The top-level screens. The nav bar switches between them; the URL hash remembers which. */
export type View = "home" | "editor" | "pixel" | "converter" | "link";

export interface AppApi {
  view: View;
  go(view: View): void;
}

export const AppContext = createContext<AppApi>({ view: "editor", go: () => {} });

export const useApp = (): AppApi => useContext(AppContext);

export const VIEW_HASH: Record<View, string> = { home: "#/", editor: "#/editor", pixel: "#/pixel", converter: "#/converter", link: "#/link" };

export function viewFromHash(hash: string): View {
  switch (hash) {
    case "#/editor":
      return "editor";
    case "#/pixel":
      return "pixel";
    case "#/converter":
      return "converter";
    case "#/link":
      return "link";
    default:
      return "home";
  }
}
