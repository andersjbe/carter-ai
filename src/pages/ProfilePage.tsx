import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "../lib/auth-client";
import { AppShell } from "../components/AppShell";
import { SearchScopeEditor } from "../components/SearchScopeEditor";

export default function ProfilePage() {
  const navigate = useNavigate();
  const { data: authSession } = authClient.useSession();
  const prefs = useQuery(
    api.userSearchPrefs.getMine,
    authSession?.user?.id ? {} : "skip",
  );
  const updateMine = useMutation(api.userSearchPrefs.updateMine);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [password, setPassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onDeleteAccount(event: FormEvent) {
    event.preventDefault();
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      const result = await authClient.deleteUser(
        password.trim()
          ? { password: password.trim() }
          : { callbackURL: `${window.location.origin}/` },
      );
      if (result.error) {
        setDeleteError(
          result.error.message ??
            "Could not delete account. If you use Google, sign out and sign back in, then try again — or enter your password if you have one.",
        );
        return;
      }
      await authClient.signOut();
      navigate("/", { replace: true });
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete account",
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <AppShell variant="profile">
      <div className="profile-page">
        <main className="panel profile-main" aria-label="Profile settings">
          <header className="profile-header">
            <h1>Profile</h1>
            <p className="hint">
              Default sites Carter searches when you start a new shopping
              query. You can change sites for any query afterward in the Open
              queries panel in chat.
            </p>
          </header>

          <section className="profile-section" aria-labelledby="search-defaults">
            <h2 id="search-defaults">Search defaults</h2>
            <p className="hint">
              Applied to new open queries. Existing queries keep their own
              settings until you edit them.
            </p>

            {prefs === undefined ? (
              <p className="empty">Loading preferences…</p>
            ) : (
              <SearchScopeEditor
                label="Marketplaces & sites"
                sources={prefs.sources}
                customDomains={prefs.customDomains}
                onChange={async (sources, customDomains) => {
                  await updateMine({ sources, customDomains });
                }}
              />
            )}
          </section>

          <p className="profile-footnote hint">
            Tip: open a query in{" "}
            <Link to="/app">Chat</Link> and use its Search toggles to override
            these defaults for that brief only.
          </p>

          <section
            className="profile-section profile-danger"
            aria-labelledby="danger-zone"
          >
            <h2 id="danger-zone">Danger zone</h2>
            <p className="hint">
              Permanently delete your Carter account, chats, shopping lists,
              preferences, and alerts. This cannot be undone.
            </p>

            {!confirmingDelete ? (
              <button
                type="button"
                className="btn btn-ghost profile-delete-btn"
                onClick={() => {
                  setConfirmingDelete(true);
                  setDeleteError(null);
                }}
              >
                Delete account
              </button>
            ) : (
              <form className="profile-delete-confirm" onSubmit={onDeleteAccount}>
                <p className="hint">
                  Type your password if you signed up with email. Google-only
                  accounts can delete after a recent sign-in.
                </p>
                <label>
                  Password (optional)
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Only if you have an email password"
                  />
                </label>
                {deleteError ? (
                  <p className="auth-error">{deleteError}</p>
                ) : null}
                <div className="profile-delete-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={deleteBusy}
                    onClick={() => {
                      setConfirmingDelete(false);
                      setPassword("");
                      setDeleteError(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-compact profile-delete-confirm-btn"
                    disabled={deleteBusy}
                  >
                    {deleteBusy ? "Deleting…" : "Yes, delete everything"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </main>
      </div>
    </AppShell>
  );
}
