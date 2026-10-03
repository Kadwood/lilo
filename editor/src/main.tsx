import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./editor.css";
import "./screens.css";
import "./views.css";
import "./glass.css";

async function boot() {
  // `?mock` (development only): sample projects and an in-memory platform, to look at every screen
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock")) {
    await (await import("./dev/mock")).installMockPlatform();
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void boot();
