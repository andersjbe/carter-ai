import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConvexReactClient } from "convex/react";
import {
  ConvexBetterAuthProvider,
  type AuthClient,
} from "@convex-dev/better-auth/react";
import { authClient } from "./lib/auth-client";
import { initTheme } from "./lib/theme";
import App from "./App";
import "./index.css";

initTheme();

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;

if (!convexUrl) {
  console.warn("VITE_CONVEX_URL is not set. Run npx convex dev.");
}

const convex = new ConvexReactClient(
  convexUrl ?? "https://placeholder.convex.cloud",
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ConvexBetterAuthProvider
        client={convex}
        authClient={authClient as unknown as AuthClient}
      >
        <App />
      </ConvexBetterAuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
