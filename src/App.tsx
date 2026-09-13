import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { authClient } from "./lib/auth-client";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import ChatApp from "./pages/ChatApp";
import ListsPage from "./pages/ListsPage";

function ProtectedApp({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="auth-loading">
        <p>Checking your session…</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={
          <ProtectedApp>
            <ChatApp />
          </ProtectedApp>
        }
      />
      <Route
        path="/app/lists"
        element={
          <ProtectedApp>
            <ListsPage />
          </ProtectedApp>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
