import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { authClient } from "../lib/auth-client";
import ThemeToggle from "../components/ThemeToggle";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const tokenError = searchParams.get("error");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(
    tokenError ? "This reset link is invalid or expired." : null,
  );
  const [busy, setBusy] = useState(false);

  if (!token && !tokenError) {
    return <Navigate to="/forgot-password" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!token) {
      setError("This reset link is invalid or expired.");
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (result.error) {
        setError(result.error.message ?? "Could not reset password");
        return;
      }
      navigate("/login?mode=signin", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-shell-top">
          <Link className="auth-brand" to="/">
            Carter
          </Link>
          <ThemeToggle />
        </div>
        <h1>Choose a new password</h1>
        <p className="auth-copy">Use at least 8 characters.</p>

        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Repeat password"
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !token}
          >
            {busy ? "Saving…" : "Update password"}
          </button>
        </form>

        <p className="auth-switch">
          <Link to="/login?mode=signin">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
