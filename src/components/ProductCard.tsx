import { useState } from "react";
import { Link } from "react-router-dom";
import type { Id } from "../../convex/_generated/dataModel";
import { formatPrice, shortenProductTitle } from "../lib/format";
import { IconPlus, IconThumbsUp, IconX } from "./icons";

const EXIT_MS = 180;

export type ProductCardData = {
  _id?: Id<"findings">;
  title: string;
  url: string;
  price: number | null;
  currency: string | null;
  source: string | null;
  summary: string | null;
  imageUrl: string | null;
  isNew?: boolean;
  verdict?: "accepted" | "rejected" | null;
};

export type ShoppingListSummary = {
  _id: Id<"shoppingLists">;
  name: string;
  updatedAt: number;
  itemCount: number;
};

type InlineProductCardProps = {
  variant: "inline";
  product: ProductCardData;
  onSetVerdict?: (
    findingId: Id<"findings">,
    verdict: "accepted" | "rejected" | null,
  ) => void | Promise<void>;
};

type FindingProductCardProps = {
  variant: "finding";
  product: ProductCardData;
  onSetVerdict?: (
    findingId: Id<"findings">,
    verdict: "accepted" | "rejected" | null,
  ) => void | Promise<void>;
  shoppingLists?: ShoppingListSummary[];
  onAddToList?: (
    findingId: Id<"findings">,
    target: Id<"shoppingLists"> | { createName: string },
  ) => Promise<Id<"shoppingLists">>;
};

type ListProductCardProps = {
  variant: "list";
  product: {
    title: string;
    url: string;
    price: number | null;
    currency: string | null;
    source: string | null;
    imageUrl: string | null;
  };
  onRemove: () => void;
};

export type ProductCardProps =
  | InlineProductCardProps
  | FindingProductCardProps
  | ListProductCardProps;

export default function ProductCard(props: ProductCardProps) {
  if (props.variant === "list") {
    return <ListProductCard {...props} />;
  }
  if (props.variant === "inline") {
    return <InlineProductCard {...props} />;
  }
  return <FindingProductCard {...props} />;
}

function ListProductCard({ product, onRemove }: ListProductCardProps) {
  const priceLabel = formatPrice(product.price, product.currency);
  const title = shortenProductTitle(product.title, 90);
  const [leaving, setLeaving] = useState(false);

  function handleRemove() {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => {
      onRemove();
    }, EXIT_MS);
  }

  return (
    <article
      className={`product-card product-card--list${leaving ? " is-leaving" : ""}`}
    >
      <a
        className="product-card-media"
        href={product.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${product.title}`}
      >
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" loading="lazy" />
        ) : (
          <div className="product-card-placeholder" aria-hidden="true">
            No image
          </div>
        )}
      </a>
      <div className="product-card-body">
        <div className="product-card-meta">
          {product.source ? (
            <span className="product-source">{product.source}</span>
          ) : null}
        </div>
        <strong>
          <a href={product.url} target="_blank" rel="noreferrer" title={product.title}>
            {title}
          </a>
        </strong>
        {priceLabel ? <p className="product-price">{priceLabel}</p> : null}
        <div className="product-card-actions">
          <button
            type="button"
            className="product-remove-btn"
            onClick={handleRemove}
            disabled={leaving}
          >
            Remove
          </button>
        </div>
      </div>
    </article>
  );
}

function useVerdictActions(
  product: ProductCardData,
  onSetVerdict?: (
    findingId: Id<"findings">,
    verdict: "accepted" | "rejected" | null,
  ) => void | Promise<void>,
) {
  const [leaving, setLeaving] = useState(false);
  const [verdictBusy, setVerdictBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isAccepted = product.verdict === "accepted";
  const canJudge = Boolean(product._id && onSetVerdict);

  async function handleVerdict(next: "accepted" | "rejected" | null) {
    if (!product._id || !onSetVerdict || verdictBusy || leaving) return;
    setActionError(null);

    if (next === "rejected") {
      setLeaving(true);
      setVerdictBusy(true);
      await new Promise((resolve) => window.setTimeout(resolve, EXIT_MS));
      try {
        await onSetVerdict(product._id, "rejected");
      } catch {
        setLeaving(false);
        setActionError("Couldn't update. Try again.");
      } finally {
        setVerdictBusy(false);
      }
      return;
    }

    setVerdictBusy(true);
    try {
      await onSetVerdict(product._id, next);
    } catch {
      setActionError("Couldn't update. Try again.");
    } finally {
      setVerdictBusy(false);
    }
  }

  return {
    leaving,
    verdictBusy,
    actionError,
    setActionError,
    isAccepted,
    canJudge,
    handleVerdict,
  };
}

function VerdictButtons({
  isAccepted,
  leaving,
  verdictBusy,
  onVerdict,
}: {
  isAccepted: boolean;
  leaving: boolean;
  verdictBusy: boolean;
  onVerdict: (next: "accepted" | "rejected" | null) => void;
}) {
  return (
    <div className="product-verdict" role="group" aria-label="Rate product">
      <button
        type="button"
        className={`product-verdict-btn${isAccepted ? " is-selected" : ""}`}
        aria-label={isAccepted ? "Unlike" : "Like"}
        aria-pressed={isAccepted}
        title={isAccepted ? "Unlike" : "Like"}
        disabled={verdictBusy || leaving}
        onClick={() => onVerdict(isAccepted ? null : "accepted")}
      >
        <IconThumbsUp />
      </button>
      {!isAccepted ? (
        <button
          type="button"
          className="product-verdict-btn product-verdict-btn-reject"
          aria-label="Pass"
          title="Pass"
          disabled={verdictBusy || leaving}
          onClick={() => onVerdict("rejected")}
        >
          <IconX />
        </button>
      ) : null}
    </div>
  );
}

/** Compact chat-inline card: thumb + title + price + Like/Pass. */
function InlineProductCard({ product, onSetVerdict }: InlineProductCardProps) {
  const priceLabel = formatPrice(product.price, product.currency);
  const title = shortenProductTitle(product.title, 56);
  const {
    leaving,
    verdictBusy,
    actionError,
    isAccepted,
    canJudge,
    handleVerdict,
  } = useVerdictActions(product, onSetVerdict);

  return (
    <article
      className={`product-card product-card--inline${isAccepted ? " is-accepted" : ""}${leaving ? " is-leaving" : ""}`}
    >
      <a
        className="product-card-media"
        href={product.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${product.title}`}
      >
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" loading="lazy" />
        ) : (
          <div className="product-card-placeholder" aria-hidden="true">
            No image
          </div>
        )}
      </a>
      <div className="product-card-body">
        <strong>
          <a
            href={product.url}
            target="_blank"
            rel="noreferrer"
            title={product.title}
          >
            {title}
          </a>
        </strong>
        <div className="product-card-inline-row">
          {priceLabel ? (
            <p className="product-price">{priceLabel}</p>
          ) : (
            <span className="product-price product-price--empty" aria-hidden="true" />
          )}
          {canJudge ? (
            <VerdictButtons
              isAccepted={isAccepted}
              leaving={leaving}
              verdictBusy={verdictBusy}
              onVerdict={(next) => void handleVerdict(next)}
            />
          ) : null}
        </div>
        {actionError ? (
          <p className="product-action-error" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/** Full Findings sidebar card: summary, tags, Like/Pass, add to list. */
function FindingProductCard({
  product,
  onSetVerdict,
  shoppingLists,
  onAddToList,
}: FindingProductCardProps) {
  const priceLabel = formatPrice(product.price, product.currency);
  const title = shortenProductTitle(product.title, 80);
  const {
    leaving,
    verdictBusy,
    actionError,
    setActionError,
    isAccepted,
    canJudge,
    handleVerdict,
  } = useVerdictActions(product, onSetVerdict);
  const canAdd = Boolean(product._id && onAddToList);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addedListId, setAddedListId] = useState<Id<"shoppingLists"> | null>(
    null,
  );

  async function addToTarget(
    target: Id<"shoppingLists"> | { createName: string },
  ) {
    if (!product._id || !onAddToList || adding) return;
    setAdding(true);
    setActionError(null);
    try {
      const listId = await onAddToList(product._id, target);
      setPickerOpen(false);
      setNewListName("");
      setAddedListId(listId);
    } catch {
      setActionError("Couldn't add to list. Try again.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <article
      className={`product-card product-card--finding${isAccepted ? " is-accepted" : ""}${leaving ? " is-leaving" : ""}`}
    >
      <a
        className="product-card-media"
        href={product.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${product.title}`}
      >
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" loading="lazy" />
        ) : (
          <div className="product-card-placeholder" aria-hidden="true">
            No image
          </div>
        )}
      </a>
      <div className="product-card-body">
        <div className="product-card-meta">
          {product.source ? (
            <span className="product-source">{product.source}</span>
          ) : null}
          {product.isNew ? <span className="badge">New</span> : null}
          {isAccepted ? <span className="badge badge-liked">Liked</span> : null}
        </div>
        <strong>
          <a
            href={product.url}
            target="_blank"
            rel="noreferrer"
            title={product.title}
          >
            {title}
          </a>
        </strong>
        {priceLabel ? <p className="product-price">{priceLabel}</p> : null}
        {product.summary ? (
          <p className="product-summary">{product.summary}</p>
        ) : null}
        {canJudge || canAdd ? (
          <div className="product-card-actions-row">
            {canAdd ? (
              <button
                type="button"
                className={`product-add-list-text${pickerOpen ? " is-selected" : ""}`}
                aria-expanded={pickerOpen}
                title="Add to list"
                disabled={leaving}
                onClick={() => {
                  setAddedListId(null);
                  setActionError(null);
                  setPickerOpen((open) => !open);
                }}
              >
                <IconPlus />
                Add to list
              </button>
            ) : (
              <span className="product-card-actions-spacer" aria-hidden="true" />
            )}
            {canJudge ? (
              <VerdictButtons
                isAccepted={isAccepted}
                leaving={leaving}
                verdictBusy={verdictBusy}
                onVerdict={(next) => void handleVerdict(next)}
              />
            ) : null}
          </div>
        ) : null}
        {addedListId ? (
          <p className="list-added-note">
            Added.{" "}
            <Link to={`/app/lists?list=${addedListId}`}>View shopping list</Link>
          </p>
        ) : null}
        {actionError ? (
          <p className="product-action-error" role="alert">
            {actionError}
          </p>
        ) : null}
        {pickerOpen && canAdd ? (
          <div className="list-picker" role="listbox" aria-label="Choose list">
            {(shoppingLists ?? []).length === 0 ? (
              <p className="hint">No lists yet — create one below.</p>
            ) : (
              (shoppingLists ?? []).map((list) => (
                <button
                  key={list._id}
                  type="button"
                  className="list-picker-option"
                  disabled={adding}
                  onClick={() => void addToTarget(list._id)}
                >
                  {list.name}
                </button>
              ))
            )}
            <form
              className="list-picker-create"
              onSubmit={(event) => {
                event.preventDefault();
                const name = newListName.trim();
                if (!name) return;
                void addToTarget({ createName: name });
              }}
            >
              <input
                type="text"
                value={newListName}
                onChange={(event) => setNewListName(event.target.value)}
                placeholder="New list name"
                aria-label="New list name"
                disabled={adding}
              />
              <button type="submit" disabled={adding || !newListName.trim()}>
                {adding ? "…" : "Create"}
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </article>
  );
}
