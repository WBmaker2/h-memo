import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WebApp } from "./WebApp";
import { registerServiceWorker, resolveServiceWorkerUrl } from "./serviceWorker";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WebApp />
  </StrictMode>
);

if (import.meta.env.PROD) {
  void registerServiceWorker(resolveServiceWorkerUrl(import.meta.env.BASE_URL));
}
