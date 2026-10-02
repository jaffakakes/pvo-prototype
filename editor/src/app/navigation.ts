import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());
window.addEventListener("popstate", changed);

export function useAppLocation() {
  const href = useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => location.href);
  return new URL(href);
}

/** Responsive views share this URL; viewport changes never navigate. */
export function navigateProject(id: string | null, replace = false) {
  const url = new URL(location.href);
  for (const key of ["home", "project", "template", "filter"]) url.searchParams.delete(key);
  if (id) url.searchParams.set("project", id);
  else url.searchParams.set("home", "1");
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  changed();
}
