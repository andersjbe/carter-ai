import { Link, Navigate } from "react-router-dom";
import { authClient } from "../lib/auth-client";

export default function LandingPage() {
  const { data: session, isPending } = authClient.useSession();

  if (!isPending && session) {
    return <Navigate to="/app" replace />;
  }

  return (
    <div className="landing">
      <div className="landing-atmosphere" aria-hidden="true" />
      <header className="landing-top">
        <p className="landing-mark">Carter</p>
        <Link className="landing-nav-link" to="/login">
          Sign in
        </Link>
      </header>

      <main className="landing-hero">
        <h1 className="landing-brand">Carter</h1>
        <p className="landing-lede">
          A curious product scout that learns what you want before searching
          Amazon, Etsy, and the web — then watches for new finds.
        </p>
        <div className="landing-actions">
          <Link className="btn btn-primary" to="/login">
            Get started
          </Link>
          <Link className="btn btn-ghost" to="/login?mode=signin">
            I already have an account
          </Link>
        </div>
      </main>
    </div>
  );
}
