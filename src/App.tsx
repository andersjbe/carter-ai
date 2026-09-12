import { Navigate, Route, Routes } from "react-router-dom";
import { authClient } from "./lib/auth-client";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import ChatApp from "./pages/ChatApp";

function ProtectedApp() {
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

  return <ChatApp />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app" element={<ProtectedApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
