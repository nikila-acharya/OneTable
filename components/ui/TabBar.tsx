'use client';

export type TabKey = 'plan' | 'recipes' | 'groceries' | 'household';

export interface TabBarProps {
  active: TabKey;
  onSelect: (tab: TabKey) => void;
  className?: string;
}

/** PRD §16.2: tabs are Plan · Recipes · Groceries · Household. The Inbox is a
 * header bell (WP-4.3) and chat is a floating button (WP-4.4) — neither is a tab. */
const TABS: ReadonlyArray<{ key: TabKey; label: string; icon: string }> = [
  {
    key: 'plan',
    label: 'Plan',
    // calendar
    icon: 'M5 6h14v13H5zM5 10h14M8 4v3M16 4v3',
  },
  {
    key: 'recipes',
    label: 'Recipes',
    // plate/bowl
    icon: 'M4 13a8 8 0 0 0 16 0zM12 5v4M9 6.5a3 3 0 0 1 6 0',
  },
  {
    key: 'groceries',
    label: 'Groceries',
    // cart
    icon: 'M4 5h2l2 9h9l2-7M7 17a1.6 1.6 0 1 0 3.2 0A1.6 1.6 0 1 0 7 17M15 17a1.6 1.6 0 1 0 3.2 0A1.6 1.6 0 1 0 15 17',
  },
  {
    key: 'household',
    label: 'Household',
    // two people
    icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 13a6 6 0 0 1 5 6',
  },
];

/**
 * 4-tab bottom bar (PRD §16.2: keep the template's bottom bar, change tab
 * names; §16.4 IA). Each tab is a 44px+ touch target; active tab is marked
 * by color AND `aria-current` (§16.6). Render inside a screen's bottom edge
 * (position: sticky/fixed by the owning screen).
 */
export function TabBar({ active, onSelect, className }: TabBarProps) {
  return (
    <nav className={['ot-tabbar', className].filter(Boolean).join(' ')} aria-label="Main tabs">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className="ot-tab"
          aria-current={active === tab.key ? 'page' : undefined}
          onClick={() => onSelect(tab.key)}
        >
          <span className="ot-tab__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <path d={tab.icon} />
            </svg>
          </span>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
