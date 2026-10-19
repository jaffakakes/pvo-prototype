import { useState } from "react";

type PageTab = "design" | "logic";
export function usePageSession(id: string) {
  const key = `restyle:component-page:${id}`;
  const [tab, setTab] = useState<PageTab>(() => {
    try {
      return sessionStorage.getItem(key) === "logic" ? "logic" : "design";
    } catch {
      return "design";
    }
  });
  const selectTab = (value: PageTab) => {
    setTab(value);
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* Storage is optional for a session preference. */
    }
  };
  return [tab, selectTab] as const;
}
