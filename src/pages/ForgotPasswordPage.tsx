import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { authClient } from "../lib/auth-client";
import ThemeToggle from "../components/ThemeToggle";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (result.error) {
        setError(result.error.message ?? "Could not send reset email");
        return;
      }
      setSent(true);
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
        <h1>Reset password</h1>
        <p className="auth-copy">
          Enter your account email and we&apos;ll send a reset link if it
          exists.
        </p>

        {sent ? (
          <p className="auth-info">
            If an account exists for that email, a reset link is on the way.
            Check your inbox, then{" "}
            <Link to="/login?mode=signin">sign in</Link>.
          </p>
        ) : (
          <form className="auth-form" onSubmit={onSubmit}>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
            {error ? <p className="auth-error">{error}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="auth-switch">
          <Link to="/login?mode=signin">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
