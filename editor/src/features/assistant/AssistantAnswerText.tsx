import type { ReactNode } from "react";

/** Render only source links, keeping all retrieved/model markup inert. */
export function AssistantAnswerText({ text }: { text: string }) {
  const content: ReactNode[] = [];
  const links = /\[([^\]\n]{1,180})\]\((https:\/\/[^\s)]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(links)) {
    const start = match.index!;
    content.push(text.slice(cursor, start));
    try {
      const url = new URL(match[2]);
      if (url.username || url.password) throw new Error("Credentials are not links.");
      content.push(<a key={start} href={url.href} target="_blank" rel="noreferrer noopener">{match[1]}</a>);
    } catch { content.push(match[0]); }
    cursor = start + match[0].length;
  }
  content.push(text.slice(cursor));
  return <>{content}</>;
}
