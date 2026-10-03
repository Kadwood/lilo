import type { AppApi } from "../app/AppContext";
import type { Command } from "../tools/commands";
import { openHelpFor, startTour } from "./guideStore";

/** Palette commands for the guide: Help (on the page for the screen you are on) and the tour. */
export function guideCommands(app: AppApi): Command[] {
  return [
    { id: "help.open", group: "Go", label: "Open Help", shortcut: "⌘?", keywords: "guide manual docs how to learn", enabled: true, run: () => void openHelpFor(`view.${app.view}`) },
    { id: "help.tour", group: "Go", label: "Replay the tour", keywords: "welcome tutorial guide walkthrough", enabled: true, run: startTour },
  ];
}
