import { Fragment, type ReactNode } from "react";

type Block =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

/** Strip markdown images; product cards already show media. */
function stripImages(text: string): string {
  return text.replace(/!\[[^\]]*]\([^)]+\)/g, "").trim();
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Bold, links, or plain runs
  const pattern =
    /(\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(
        <Fragment key={`${keyPrefix}-t-${i++}`}>
          {text.slice(last, match.index)}
        </Fragment>,
      );
    }
    if (match[2]) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${i++}`}>{match[2]}</strong>,
      );
    } else if (match[3] && match[4]) {
      nodes.push(
        <a
          key={`${keyPrefix}-a-${i++}`}
          href={match[4]}
          target="_blank"
          rel="noreferrer"
        >
          {match[3]}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    nodes.push(
      <Fragment key={`${keyPrefix}-t-${i++}`}>{text.slice(last)}</Fragment>,
    );
  }

  return nodes;
}

function parseBlocks(raw: string): Block[] {
  const lines = stripImages(raw).replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n").trim();
    paragraph = [];
    if (text) blocks.push({ type: "p", text });
  }

  function flushList() {
    if (!listType || listItems.length === 0) {
      listType = null;
      listItems = [];
      return;
    }
    blocks.push({ type: listType, items: listItems });
    listType = null;
    listItems = [];
  }

  for (const line of lines) {
    const ul = line.match(/^\s*[-*]\s+(.+)$/);
    const ol = line.match(/^\s*\d+\.\s+(.+)$/);

    if (ul) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(ul[1]!.trim());
      continue;
    }

    if (ol) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ol[1]!.trim());
      continue;
    }

    if (line.trim() === "") {
      flushList();
      flushParagraph();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushList();
  flushParagraph();
  return blocks;
}

export function MessageMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;

  return (
    <div className="message-md">
      {blocks.map((block, index) => {
        if (block.type === "p") {
          return (
            <p key={`p-${index}`}>{renderInline(block.text, `p-${index}`)}</p>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={`ul-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`ul-${index}-${itemIndex}`}>
                  {renderInline(item, `ul-${index}-${itemIndex}`)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <ol key={`ol-${index}`}>
            {block.items.map((item, itemIndex) => (
              <li key={`ol-${index}-${itemIndex}`}>
                {renderInline(item, `ol-${index}-${itemIndex}`)}
              </li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}
