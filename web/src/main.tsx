import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./brand.css";
import "./styles.css";
import { applyTheme, tg } from "./tg";

applyTheme();
tg?.ready();
tg?.expand();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
