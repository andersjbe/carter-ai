import { useQuery, useMutation } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { authClient } from "../lib/auth-client";
import { AppShell } from "../components/AppShell";
import { SearchScopeEditor } from "../components/SearchScopeEditor";

export default function ProfilePage() {
  const { data: authSession } = authClient.useSession();
  const prefs = useQuery(
    api.userSearchPrefs.getMine,
    authSession?.user?.id ? {} : "skip",
  );
  const updateMine = useMutation(api.userSearchPrefs.updateMine);

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
        </main>
      </div>
    </AppShell>
  );
}
