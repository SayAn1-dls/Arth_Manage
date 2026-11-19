import { useCallback, useEffect, useState } from 'react';

/** Explicit user choices only: `true` = opened by the user, `false` = collapsed by the user. */
export type NavChoices = Record<string, boolean>;

const PREFIX = 'ak.nav.v1';

export const navStorageKey = (scope: string) => `${PREFIX}:${scope}`;

/** Keeps only known group ids with boolean values, so stale or tampered storage can never break the menu. */
export function parseNavChoices(raw: string | null, validIds: readonly string[]): NavChoices {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const out: NavChoices = {};
    for (const id of validIds) {
      const v = (value as Record<string, unknown>)[id];
      if (typeof v === 'boolean') out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** A group is open if the user chose so, otherwise only when it holds the current page. */
export const isGroupOpen = (choices: NavChoices, id: string, activeId: string | null) =>
  choices[id] ?? id === activeId;

function read(scope: string, validIds: readonly string[]): NavChoices {
  try {
    return parseNavChoices(window.localStorage.getItem(navStorageKey(scope)), validIds);
  } catch {
    return {};
  }
}

/**
 * Per-scope (role + event) expand/collapse preferences. Only group ids and booleans are stored.
 * Moving to another page clears a manual collapse of the group that now holds the page, so the
 * current location always stays discoverable.
 */
export function useNavChoices(scope: string, validIds: readonly string[], pageKey: string) {
  const ids = validIds.join('|');
  const [state, setState] = useState(() => ({ scope, choices: read(scope, validIds) }));
  // Re-read when the scope (another event or role) changes so preferences never leak across them.
  const choices = state.scope === scope ? state.choices : read(scope, validIds);
  if (state.scope !== scope) setState({ scope, choices });

  const save = useCallback(
    (next: NavChoices) => {
      setState({ scope, choices: next });
      try {
        window.localStorage.setItem(navStorageKey(scope), JSON.stringify(next));
      } catch {
        /* storage unavailable: the choice still applies for this page view */
      }
    },
    [scope],
  );

  const toggle = (id: string, currentlyOpen: boolean) => save({ ...choices, [id]: !currentlyOpen });

  // pageKey identifies the active group + page; a new page reveals its group again.
  useEffect(() => {
    const active = pageKey.split('\u0000')[0];
    if (active && choices[active] === false) {
      const rest = { ...choices };
      delete rest[active];
      save(rest);
    }
  }, [pageKey, ids]);

  return { choices, toggle };
}
