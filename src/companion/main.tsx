import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { CompanionApp } from "./CompanionApp";
import "../i18n";

// The companion window is a decorationless overlay: no browser context menu,
// and the page background must stay transparent for the sprite to float.
if (import.meta.env.PROD) {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CompanionApp />
  </StrictMode>
);
