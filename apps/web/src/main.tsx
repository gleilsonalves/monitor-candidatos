import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { WeightsProvider } from "./context/WeightsContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <WeightsProvider>
        <App />
      </WeightsProvider>
    </BrowserRouter>
  </StrictMode>
);
