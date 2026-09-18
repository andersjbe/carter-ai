import { Link, Navigate } from "react-router-dom";
import { authClient } from "../lib/auth-client";
import ThemeToggle from "../components/ThemeToggle";
import { IconBell, IconList, IconSearch, IconSites } from "../components/icons";

const FEATURES = [
  {
    icon: IconSearch,
    title: "Ask once, then scout",
    body: "Carter learns your budget, style, and must-haves — then searches where you want it to look.",
  },
  {
    icon: IconSites,
    title: "Choose your sites",
    body: "Toggle Amazon and Etsy, turn on Discover stores for specialty-site suggestions, or add shops you trust — set defaults in Profile, or per query while you shop.",
  },
  {
    icon: IconList,
    title: "Save what fits",
    body: "Like or pass picks to train future finds, and save keepers on named shopping lists.",
  },
  {
    icon: IconBell,
    title: "Watch for drops",
    body: "Turn on email alerts for a list and Carter will nudge you when prices move.",
  },
] as const;

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
        <div className="landing-top-actions">
          <ThemeToggle />
          <Link className="landing-nav-link" to="/login">
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <h1 className="landing-brand">Carter</h1>
            <p className="landing-subhead">
              A curious product scout that learns what you want.
            </p>
            <p className="landing-lede">
              Searches the sites you choose, and watches for new finds.
            </p>
            <div className="landing-actions">
              <Link className="btn btn-primary" to="/login">
                Get started
              </Link>
              <Link className="landing-actions-link" to="/login?mode=signin">
                I already have an account
              </Link>
            </div>
          </div>

          <div className="landing-preview" aria-hidden="true">
            <div className="landing-preview-chat">
              <p className="landing-preview-user">
                Looking for a quiet desk lamp under $80 — warm light, not harsh.
              </p>
              <p className="landing-preview-assistant">
                Got it — warm glow, under eighty. Here are two that fit.
              </p>
            </div>
            <div className="landing-preview-products">
              {/* Photos: Unsplash — Kam Idris (desk) / Adrien Olichon (pendant) */}
              <div className="landing-preview-card">
                <img
                  className="landing-preview-thumb"
                  src="/landing/desk-lamp.jpg"
                  alt=""
                  width={400}
                  height={300}
                />
                <div className="landing-preview-card-meta">
                  <span className="landing-preview-title">Warm ceramic desk lamp</span>
                  <span className="landing-preview-price">Under $80</span>
                </div>
              </div>
              <div className="landing-preview-card">
                <img
                  className="landing-preview-thumb"
                  src="/landing/pendant-lamp.jpg"
                  alt=""
                  width={400}
                  height={300}
                />
                <div className="landing-preview-card-meta">
                  <span className="landing-preview-title">Soft pendant light</span>
                  <span className="landing-preview-price">Warm glow</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-features" aria-labelledby="landing-features-heading">
          <h2 id="landing-features-heading" className="landing-features-heading">
            Built to choose, find, save, and watch
          </h2>
          <ul className="landing-feature-list">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <li
                  key={feature.title}
                  className="landing-feature"
                  style={{ animationDelay: `${0.12 + index * 0.08}s` }}
                >
                  <span className="landing-feature-icon">
                    <Icon />
                  </span>
                  <div>
                    <h3 className="landing-feature-title">{feature.title}</h3>
                    <p className="landing-feature-body">{feature.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="landing-close">
          <p className="landing-close-copy">Ready when you are.</p>
          <Link className="btn btn-primary" to="/login">
            Get started
          </Link>
        </section>
      </main>

      <footer className="landing-footer">
        <p className="landing-mark">Carter</p>
      </footer>
    </div>
  );
}
