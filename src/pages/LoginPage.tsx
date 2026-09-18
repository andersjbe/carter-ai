import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { authClient } from "../lib/auth-client";
import ThemeToggle from "../components/ThemeToggle";

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const initialMode =
    searchParams.get("mode") === "signin" ? "signin" : "signup";
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);

  if (!isPending && session) {
    return <Navigate to="/app" replace />;
  }

  async function onGoogleSignIn() {
    setError(null);
    setInfo(null);
    setNeedsVerification(false);
    setGoogleBusy(true);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: `${window.location.origin}/app`,
      });
      if (result.error) {
        setError(result.error.message ?? "Could not start Google sign-in");
        setGoogleBusy(false);
      }
      // On success the browser redirects to Google; keep the button busy.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setGoogleBusy(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setNeedsVerification(false);
    setBusy(true);
    try {
      if (mode === "signup") {
        const result = await authClient.signUp.email({
          name: name.trim() || email.split("@")[0] || "Carter shopper",
          email: email.trim(),
          password,
          callbackURL: `${window.location.origin}/app`,
        });
        if (result.error) {
          setError(result.error.message ?? "Could not create account");
          return;
        }
        setNeedsVerification(true);
        setInfo(
          "Check your email for a verification link, then sign in. Google sign-in skips this step.",
        );
        setMode("signin");
        setPassword("");
        return;
      }

      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (result.error) {
        const message = result.error.message ?? "Could not sign in";
        if (result.error.status === 403) {
          setNeedsVerification(true);
          setError(
            "Verify your email before signing in. Check your inbox for the link.",
          );
        } else {
          setError(message);
        }
        return;
      }
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function onResendVerification() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email first, then resend the verification link.");
      return;
    }
    setError(null);
    setInfo(null);
    setResendBusy(true);
    try {
      const result = await authClient.sendVerificationEmail({
        email: trimmed,
        callbackURL: `${window.location.origin}/app`,
      });
      if (result.error) {
        setError(result.error.message ?? "Could not resend verification email");
        return;
      }
      setInfo("Verification email sent. Check your inbox (and spam).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setResendBusy(false);
    }
  }

  const anyBusy = busy || googleBusy || resendBusy;

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-shell-top">
          <Link className="auth-brand" to="/">
            Carter
          </Link>
          <ThemeToggle />
        </div>
        <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
        <p className="auth-copy">
          {mode === "signup"
            ? "Save preferences, shopping lists, and price alerts under your account."
            : "Sign in to pick up where Carter left off."}
        </p>

        <button
          className="btn btn-primary auth-google"
          type="button"
          disabled={anyBusy}
          onClick={() => void onGoogleSignIn()}
        >
          <GoogleMark />
          {googleBusy ? "Redirecting…" : "Continue with Google"}
        </button>

        {!showEmailForm ? (
          <button
            type="button"
            className="auth-email-toggle"
            onClick={() => setShowEmailForm(true)}
          >
            or use email instead
          </button>
        ) : (
          <>
            <div className="auth-divider" role="separator">
              <span>or email</span>
            </div>

            <form className="auth-form" onSubmit={onSubmit}>
              {mode === "signup" ? (
                <label>
                  Name
                  <input
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Alex"
                  />
                </label>
              ) : null}
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
              <label>
                Password
                <input
                  type="password"
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                />
              </label>
              {mode === "signin" ? (
                <p className="auth-forgot">
                  <Link to="/forgot-password">Forgot password?</Link>
                </p>
              ) : null}
              {error ? <p className="auth-error">{error}</p> : null}
              {info ? <p className="auth-info">{info}</p> : null}
              {needsVerification ? (
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={anyBusy || !email.trim()}
                  onClick={() => void onResendVerification()}
                >
                  {resendBusy ? "Sending…" : "Resend verification email"}
                </button>
              ) : null}
              <button
                className="btn btn-primary"
                type="submit"
                disabled={anyBusy}
              >
                {busy
                  ? mode === "signup"
                    ? "Creating…"
                    : "Signing in…"
                  : mode === "signup"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>
          </>
        )}
        {!showEmailForm && error ? (
          <p className="auth-error">{error}</p>
        ) : null}
        {!showEmailForm && info ? <p className="auth-info">{info}</p> : null}

        <p className="auth-switch">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => setMode("signin")}>
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button type="button" onClick={() => setMode("signup")}>
                Create an account
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg
      className="auth-google-icon"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
