import { useState } from "react";
import { Link } from "react-router-dom";
import type { Id } from "../../convex/_generated/dataModel";
import { formatPrice } from "../lib/format";
import { IconPlus, IconThumbsUp, IconX } from "./icons";

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

type ChatProductCardProps = {
  variant: "chat";
  product: ProductCardData;
  onSetVerdict?: (
    findingId: Id<"findings">,
    verdict: "accepted" | "rejected" | null,
  ) => void;
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

export type ProductCardProps = ChatProductCardProps | ListProductCardProps;

export default function ProductCard(props: ProductCardProps) {
  if (props.variant === "list") {
    return <ListProductCard {...props} />;
  }
  return <ChatProductCard {...props} />;
}

function ListProductCard({ product, onRemove }: ListProductCardProps) {
  const priceLabel = formatPrice(product.price, product.currency);

  return (
    <article className="product-card product-card--list">
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
          <a href={product.url} target="_blank" rel="noreferrer">
            {product.title}
          </a>
        </strong>
        {priceLabel ? <p className="product-price">{priceLabel}</p> : null}
        <div className="product-card-actions">
          <button
            type="button"
            className="product-remove-btn"
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      </div>
    </article>
  );
}

function ChatProductCard({
  product,
  onSetVerdict,
  shoppingLists,
  onAddToList,
}: ChatProductCardProps) {
  const priceLabel = formatPrice(product.price, product.currency);
  const isAccepted = product.verdict === "accepted";
  const canJudge = Boolean(product._id && onSetVerdict);
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
    try {
      const listId = await onAddToList(product._id, target);
      setPickerOpen(false);
      setNewListName("");
      setAddedListId(listId);
    } catch (error) {
      console.error("Failed to add to shopping list", error);
    } finally {
      setAdding(false);
    }
  }

  return (
    <article
      className={`product-card product-card--chat${isAccepted ? " is-accepted" : ""}`}
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
          <a href={product.url} target="_blank" rel="noreferrer">
            {product.title}
          </a>
        </strong>
        {priceLabel ? <p className="product-price">{priceLabel}</p> : null}
        {product.summary ? (
          <p className="product-summary">{product.summary}</p>
        ) : null}
        {canJudge && product._id && onSetVerdict ? (
          <div className="product-verdict" role="group" aria-label="Rate product">
            <button
              type="button"
              className={`product-verdict-btn${isAccepted ? " is-selected" : ""}`}
              aria-label={isAccepted ? "Unlike" : "Like"}
              aria-pressed={isAccepted}
              title={isAccepted ? "Unlike" : "Like"}
              onClick={() =>
                onSetVerdict(product._id!, isAccepted ? null : "accepted")
              }
            >
              <IconThumbsUp />
            </button>
            {!isAccepted ? (
              <button
                type="button"
                className="product-verdict-btn product-verdict-btn-reject"
                aria-label="Reject"
                title="Reject"
                onClick={() => onSetVerdict(product._id!, "rejected")}
              >
                <IconX />
              </button>
            ) : null}
          </div>
        ) : null}
        {canAdd ? (
          <div className="product-verdict" role="group" aria-label="Shopping list">
            <button
              type="button"
              className={`product-add-list-text${pickerOpen ? " is-selected" : ""}`}
              aria-expanded={pickerOpen}
              title="Add to list"
              onClick={() => {
                setAddedListId(null);
                setPickerOpen((open) => !open);
              }}
            >
              <IconPlus />
              Add to list
            </button>
          </div>
        ) : null}
        {addedListId ? (
          <p className="list-added-note">
            Added.{" "}
            <Link to={`/app/lists?list=${addedListId}`}>View shopping list</Link>
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
