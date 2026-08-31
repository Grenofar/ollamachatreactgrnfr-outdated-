import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import StandaloneApp from "./controlme-standalone/StandaloneApp";

// Same codebase, two builds: the standalone Control Me installer is built
// with `vite build --mode controlme` (see package.json's build:controlme
// script and src-tauri/tauri.controlme.conf.json), which sets this env var
// via .env.controlme — everything else (Rust commands, API client) is
// shared as-is, only the root component differs.
const Root = import.meta.env.VITE_STANDALONE === "controlme" ? StandaloneApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
