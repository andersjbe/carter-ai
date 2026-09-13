import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth-client";
import ThemeToggle from "./ThemeToggle";

type AppNav = "chat" | "lists";

export function AppShell({
  variant,
  children,
}: {
  variant: "chat" | "lists";
  children: ReactNode;
}) {
  return (
    <div className={`app-shell app-shell--${variant}`}>
      <AppTopbar current={variant === "chat" ? "chat" : "lists"} />
      {children}
    </div>
  );
}

export function AppTopbar({ current }: { current: AppNav }) {
  const navigate = useNavigate();
  const { data: authSession } = authClient.useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
      navigate("/", { replace: true });
    } finally {
      setSigningOut(false);
      setMenuOpen(false);
    }
  }

  const email = authSession?.user?.email ?? null;

  return (
    <header className="app-topbar">
      <Link className="app-topbar-brand" to="/app">
        Carter
      </Link>
      <div className="app-topbar-actions">
        <nav className="app-topbar-nav" aria-label="Primary">
          {current === "chat" ? (
            <span
              className="btn btn-ghost btn-compact is-current"
              aria-current="page"
            >
              Chat
            </span>
          ) : (
            <Link className="btn btn-ghost btn-compact" to="/app">
              Chat
            </Link>
          )}
          {current === "lists" ? (
            <span
              className="btn btn-ghost btn-compact is-current"
              aria-current="page"
            >
              Lists
            </span>
          ) : (
            <Link className="btn btn-ghost btn-compact" to="/app/lists">
              Lists
            </Link>
          )}
        </nav>
        <ThemeToggle />
        <div className="account-menu" ref={menuRef}>
          <button
            type="button"
            className="btn btn-ghost btn-compact account-menu-trigger"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {email ? (
              <span className="account-email">{email}</span>
            ) : (
              "Account"
            )}
          </button>
          {menuOpen ? (
            <div className="account-menu-panel" role="menu">
              {email ? (
                <p className="account-menu-email" role="none">
                  {email}
                </p>
              ) : null}
              <button
                type="button"
                className="account-menu-item"
                role="menuitem"
                onClick={() => void onSignOut()}
                disabled={signingOut}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
