import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authClient } from "../lib/auth-client";
import ThemeToggle from "../components/ThemeToggle";

function formatPrice(price: number | null, currency: string | null) {
  if (price == null) return null;
  const cur = currency ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
    }).format(price);
  } catch {
    return `${cur} ${price}`;
  }
}

function IconX({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export default function ListsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: authSession } = authClient.useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [renameListName, setRenameListName] = useState("");
  const [listBusy, setListBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [alertBusy, setAlertBusy] = useState(false);

  const shoppingLists = useQuery(
    api.shoppingLists.listMine,
    authSession?.user?.id ? {} : "skip",
  );

  const selectedListIdParam = searchParams.get("list");
  const selectedListId =
    selectedListIdParam && shoppingLists
      ? (shoppingLists.find((list) => list._id === selectedListIdParam)?._id ??
        null)
      : null;

  const selectedList = useQuery(
    api.shoppingLists.get,
    selectedListId ? { listId: selectedListId } : "skip",
  );
  const alertPrefs = useQuery(
    api.mail.getPrefs,
    selectedListId ? { listId: selectedListId } : "skip",
  );

  const createList = useMutation(api.shoppingLists.create);
  const renameList = useMutation(api.shoppingLists.rename);
  const removeList = useMutation(api.shoppingLists.remove);
  const removeListItem = useMutation(api.shoppingLists.removeItem);
  const setAlerts = useMutation(api.mail.setAlerts);

  useEffect(() => {
    if (!shoppingLists || shoppingLists.length === 0) return;
    if (
      selectedListIdParam &&
      shoppingLists.some((list) => list._id === selectedListIdParam)
    ) {
      return;
    }
    setSearchParams(
      { list: shoppingLists[0]!._id },
      { replace: !selectedListIdParam },
    );
  }, [shoppingLists, selectedListIdParam, setSearchParams]);

  useEffect(() => {
    setRenameListName(selectedList?.name ?? "");
  }, [selectedList?.name, selectedListId]);

  useEffect(() => {
    setEmail(alertPrefs?.email ?? "");
  }, [alertPrefs, selectedListId]);

  const alertsOn = alertPrefs?.enabled === true;
  async function onSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
      navigate("/", { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  function selectList(listId: Id<"shoppingLists">) {
    setSearchParams({ list: listId });
  }

  async function onCreateList(event: FormEvent) {
    event.preventDefault();
    const name = newListName.trim();
    if (!name || listBusy) return;
    setListBusy(true);
    try {
      const listId = await createList({ name });
      setNewListName("");
      selectList(listId);
    } finally {
      setListBusy(false);
    }
  }

  async function onRenameList(event: FormEvent) {
    event.preventDefault();
    if (!selectedListId || listBusy) return;
    const name = renameListName.trim();
    if (!name) return;
    setListBusy(true);
    try {
      await renameList({ listId: selectedListId, name });
    } finally {
      setListBusy(false);
    }
  }

  async function onDeleteList() {
    if (!selectedListId || listBusy) return;
    if (!window.confirm("Delete this shopping list and its items?")) return;
    setListBusy(true);
    try {
      await removeList({ listId: selectedListId });
      setSearchParams({});
    } finally {
      setListBusy(false);
    }
  }

  async function onSaveAlerts(event: FormEvent) {
    event.preventDefault();
    if (!selectedListId) return;
    const trimmed = email.trim();
    if (!trimmed.includes("@")) return;
    setAlertBusy(true);
    try {
      await setAlerts({
        listId: selectedListId,
        enabled: true,
        email: trimmed,
      });
    } finally {
      setAlertBusy(false);
    }
  }

  async function onTurnOffAlerts() {
    if (!selectedListId || alertBusy) return;
    setAlertBusy(true);
    try {
      await setAlerts({
        listId: selectedListId,
        enabled: false,
        email: email.trim() || undefined,
      });
    } finally {
      setAlertBusy(false);
    }
  }

  return (
    <div className="app-shell app-shell--lists">
      <header className="app-topbar">
        <Link className="app-topbar-brand" to="/app">
          Carter
        </Link>
        <div className="app-topbar-actions">
          <Link className="btn btn-ghost btn-compact" to="/app">
            Chat
          </Link>
          <span className="btn btn-ghost btn-compact is-current" aria-current="page">
            Lists
          </span>
          {authSession?.user?.email ? (
            <span className="account-email">{authSession.user.email}</span>
          ) : null}
          <ThemeToggle />
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => void onSignOut()}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>

      <div className="lists-page">
        <aside className="panel lists-sidebar" aria-label="Your shopping lists">
          <div className="lists-sidebar-header">
            <h1>Shopping lists</h1>
            <p className="hint">
              Track what you intend to buy — separate from likes in chat.
            </p>
          </div>
          <form className="list-create-form" onSubmit={onCreateList}>
            <input
              type="text"
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              placeholder="New list name"
              aria-label="New list name"
            />
            <button type="submit" disabled={listBusy || !newListName.trim()}>
              Create
            </button>
          </form>
          <div className="list-switcher" role="list">
            {shoppingLists === undefined ? (
              <p className="empty">Loading lists…</p>
            ) : shoppingLists.length === 0 ? (
              <p className="empty">No lists yet.</p>
            ) : (
              shoppingLists.map((list) => (
                <button
                  key={list._id}
                  type="button"
                  role="listitem"
                  className={`list-switcher-item${selectedListId === list._id ? " is-active" : ""}`}
                  onClick={() => selectList(list._id)}
                >
                  <span>{list.name}</span>
                  <span className="badge">{list.itemCount}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="panel lists-main" aria-label="List details">
          {selectedListId && selectedList ? (
            <>
              <section className="lists-detail-section">
                <h2>{selectedList.name}</h2>
                <form className="list-rename-form" onSubmit={onRenameList}>
                  <input
                    type="text"
                    value={renameListName}
                    onChange={(event) => setRenameListName(event.target.value)}
                    aria-label="Rename list"
                  />
                  <button
                    type="submit"
                    disabled={
                      listBusy ||
                      !renameListName.trim() ||
                      renameListName.trim() === selectedList.name
                    }
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="danger-btn"
                    disabled={listBusy}
                    onClick={() => void onDeleteList()}
                  >
                    Delete
                  </button>
                </form>
                <div className="lists-item-grid">
                  {selectedList.items.length === 0 ? (
                    <p className="empty">
                      No items yet. Add products from chat with Add to list.
                    </p>
                  ) : (
                    selectedList.items.map((item) => (
                      <article className="product-card" key={item._id}>
                        <a
                          className="product-card-media"
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${item.title}`}
                        >
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt="" loading="lazy" />
                          ) : (
                            <div
                              className="product-card-placeholder"
                              aria-hidden="true"
                            >
                              No image
                            </div>
                          )}
                        </a>
                        <div className="product-card-body">
                          <div className="product-card-meta">
                            <span className="product-source">{item.source}</span>
                          </div>
                          <strong>
                            <a href={item.url} target="_blank" rel="noreferrer">
                              {item.title}
                            </a>
                          </strong>
                          {formatPrice(item.price, item.currency) ? (
                            <p className="product-price">
                              {formatPrice(item.price, item.currency)}
                            </p>
                          ) : null}
                          <div className="product-verdict">
                            <button
                              type="button"
                              className="product-verdict-btn product-verdict-btn-reject"
                              aria-label="Remove from list"
                              title="Remove from list"
                              onClick={() =>
                                void removeListItem({ itemId: item._id })
                              }
                            >
                              <IconX />
                            </button>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>

              <section className="alerts lists-detail-section">
                <h3>Email alerts</h3>
                <p className="hint">
                  Get emailed when Carter spots a price drop on items in this
                  list.
                </p>
                {alertsOn ? (
                  <p className="alert-status" role="status">
                    Alerts on for {alertPrefs?.email ?? "this list"}.
                  </p>
                ) : null}
                <form onSubmit={onSaveAlerts}>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    aria-label="Alert email"
                    required
                  />
                  <button
                    type="submit"
                    disabled={
                      !selectedListId || alertBusy || !email.trim().includes("@")
                    }
                  >
                    {alertBusy
                      ? "Saving…"
                      : alertsOn
                        ? "Update email"
                        : "Turn on alerts"}
                  </button>
                </form>
                {alertsOn ? (
                  <button
                    type="button"
                    className="danger-btn alert-off-btn"
                    disabled={alertBusy}
                    onClick={() => void onTurnOffAlerts()}
                  >
                    Turn off alerts
                  </button>
                ) : null}
              </section>
            </>
          ) : (
            <div className="lists-empty-state">
              <h2>No list selected</h2>
              <p className="hint">
                Create a list on the left, or add a product from chat to get
                started.
              </p>
              <Link className="btn" to="/app">
                Back to chat
              </Link>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
