import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authClient } from "../lib/auth-client";
import { AppShell } from "../components/AppShell";
import ProductCard from "../components/ProductCard";
import { IconMore, IconPencil } from "../components/icons";

export default function ListsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: authSession } = authClient.useSession();
  const [newListName, setNewListName] = useState("");
  const [listBusy, setListBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [alertBusy, setAlertBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

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
    setTitleDraft(selectedList?.name ?? "");
    setEditingTitle(false);
    setMenuOpen(false);
  }, [selectedList?.name, selectedListId]);

  useEffect(() => {
    setEmail(alertPrefs?.email ?? "");
    if (alertPrefs?.enabled) setAlertsOpen(true);
  }, [alertPrefs, selectedListId]);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const alertsOn = alertPrefs?.enabled === true;

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

  async function commitRename() {
    if (!selectedListId || listBusy || !selectedList) return;
    const name = titleDraft.trim();
    if (!name || name === selectedList.name) {
      setTitleDraft(selectedList.name);
      setEditingTitle(false);
      return;
    }
    setListBusy(true);
    try {
      await renameList({ listId: selectedListId, name });
      setEditingTitle(false);
    } finally {
      setListBusy(false);
    }
  }

  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename();
    }
    if (event.key === "Escape") {
      setTitleDraft(selectedList?.name ?? "");
      setEditingTitle(false);
    }
  }

  async function onDeleteList() {
    if (!selectedListId || listBusy) return;
    if (!window.confirm("Delete this shopping list and its items?")) return;
    setMenuOpen(false);
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
    <AppShell variant="lists">
      <div className="lists-page">
        <aside className="panel lists-sidebar" aria-label="Your shopping lists">
          <div className="lists-sidebar-header">
            <h1>Shopping lists</h1>
            <p className="hint lists-sidebar-hint">Buy-intent lists</p>
          </div>
          <form className="list-create-form" onSubmit={onCreateList}>
            <input
              type="text"
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              placeholder="New list name"
              aria-label="New list name"
            />
            <button
              type="submit"
              className="btn-accent-compact"
              disabled={listBusy || !newListName.trim()}
            >
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
          {selectedListId && selectedList === undefined ? (
            <div className="lists-empty-state">
              <h2>Loading list…</h2>
              <p className="hint">Fetching your list details.</p>
            </div>
          ) : selectedListId && selectedList ? (
            <>
              <header className="lists-detail-header">
                <div className="lists-title-row">
                  {editingTitle ? (
                    <input
                      ref={titleInputRef}
                      className="lists-title-input"
                      type="text"
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onBlur={() => void commitRename()}
                      onKeyDown={onTitleKeyDown}
                      aria-label="List name"
                      disabled={listBusy}
                    />
                  ) : (
                    <h2 className="lists-title">
                      <button
                        type="button"
                        className="lists-title-button"
                        onClick={() => setEditingTitle(true)}
                      >
                        {selectedList.name}
                      </button>
                    </h2>
                  )}
                  <div className="lists-title-actions">
                    {!editingTitle ? (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Rename list"
                        title="Rename"
                        onClick={() => setEditingTitle(true)}
                      >
                        <IconPencil />
                      </button>
                    ) : null}
                    <div className="lists-overflow" ref={menuRef}>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="List options"
                        aria-expanded={menuOpen}
                        aria-haspopup="menu"
                        onClick={() => setMenuOpen((open) => !open)}
                      >
                        <IconMore />
                      </button>
                      {menuOpen ? (
                        <div className="lists-overflow-panel" role="menu">
                          <button
                            type="button"
                            className="lists-overflow-item danger-btn"
                            role="menuitem"
                            disabled={listBusy}
                            onClick={() => void onDeleteList()}
                          >
                            Delete list
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <details
                  className="lists-alerts-disclosure"
                  open={alertsOpen}
                  onToggle={(event) =>
                    setAlertsOpen((event.target as HTMLDetailsElement).open)
                  }
                >
                  <summary>
                    Price alerts
                    {alertsOn ? (
                      <span className="lists-alerts-pill">On</span>
                    ) : (
                      <span className="lists-alerts-pill is-off">Off</span>
                    )}
                  </summary>
                  <div className="lists-alerts-body">
                    <p className="hint">
                      Email when Carter spots a price drop on items in this
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
                        className="btn btn-ghost btn-compact"
                        disabled={
                          !selectedListId ||
                          alertBusy ||
                          !email.trim().includes("@")
                        }
                      >
                        {alertBusy
                          ? "Saving…"
                          : alertsOn
                            ? "Update email"
                            : "Turn on"}
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
                  </div>
                </details>
              </header>

              <section className="lists-detail-section">
                <div className="lists-item-grid">
                  {selectedList.items.length === 0 ? (
                    <div className="lists-empty-items">
                      <p className="empty">No items yet.</p>
                      <Link className="btn btn-primary" to="/app">
                        Find gifts in chat
                      </Link>
                    </div>
                  ) : (
                    selectedList.items.map((item) => (
                      <ProductCard
                        key={item._id}
                        variant="list"
                        product={{
                          title: item.title,
                          url: item.url,
                          price: item.price,
                          currency: item.currency,
                          source: item.source,
                          imageUrl: item.imageUrl,
                        }}
                        onRemove={() =>
                          void removeListItem({ itemId: item._id })
                        }
                      />
                    ))
                  )}
                </div>
              </section>
            </>
          ) : (
            <div className="lists-empty-state">
              <h2>No list selected</h2>
              <p className="hint">
                Create a list on the left, or add a product from chat to get
                started.
              </p>
              <Link className="btn btn-primary" to="/app">
                Find gifts in chat
              </Link>
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}
