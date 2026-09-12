export const DEFAULT_SESSION_TITLE = "New chat";
export const MAX_SESSION_TITLE_LENGTH = 48;

export function titleFromPrompt(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_SESSION_TITLE_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_SESSION_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function isDefaultSessionTitle(title: string | undefined): boolean {
  const current = title?.trim() ?? "";
  return current.length === 0 || current === DEFAULT_SESSION_TITLE;
}

/** Empty = never messaged (or legacy untitled “New chat”). */
export function sessionIsEmpty(session: {
  isEmpty?: boolean;
  title?: string;
}): boolean {
  if (session.isEmpty === true) return true;
  if (session.isEmpty === false) return false;
  return isDefaultSessionTitle(session.title);
}
