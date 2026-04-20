import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { RAIL_GROUPS, RAIL_LEAFS } from '@/data/taxonomy';

interface Props {
  /** Currently active category label (top-level group OR child sub-category OR "All"). */
  active: string;
  onChange: (label: string) => void;
}

const RAIL_GROUP_LABELS = RAIL_GROUPS.map((g) => g.label);

export function CategoryRail({ active, onChange }: Props) {
  // Start with the active group's parent expanded so the user can see context.
  const initiallyOpen = (() => {
    const set = new Set<string>();
    for (const g of RAIL_GROUPS) {
      if (g.label === active || g.items?.includes(active)) set.add(g.label);
    }
    return set;
  })();
  const [open, setOpen] = useState<Set<string>>(initiallyOpen);

  const toggle = (label: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const isActive = (label: string) => active === label;

  return (
    <nav aria-label="Categories" className="text-sm">
      <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-foreground">Category</h3>

      <ul className="space-y-1 mb-4">
        {RAIL_LEAFS.map((leaf) => (
          <li key={leaf}>
            <button
              onClick={() => onChange(leaf)}
              className={`w-full text-left py-1.5 transition-colors ${
                isActive(leaf)
                  ? 'text-primary font-semibold'
                  : 'text-foreground/80 hover:text-foreground'
              }`}
              data-testid={`rail-leaf-${leaf.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {leaf}
            </button>
          </li>
        ))}
      </ul>

      <ul className="space-y-1">
        {RAIL_GROUPS.map((group) => {
          const expanded = open.has(group.label) || group.items === undefined;
          const groupActive = isActive(group.label);
          const childActive = group.items?.includes(active) ?? false;
          return (
            <li key={group.label}>
              <div className="flex items-stretch">
                <button
                  onClick={() => onChange(group.label)}
                  className={`flex-1 text-left py-1.5 transition-colors ${
                    groupActive || childActive
                      ? 'text-primary font-semibold'
                      : 'text-foreground/90 hover:text-foreground'
                  }`}
                  data-testid={`rail-group-${group.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                >
                  {group.label}
                </button>
                {group.items && group.items.length > 0 && (
                  <button
                    onClick={() => toggle(group.label)}
                    className="px-2 text-muted-foreground hover:text-foreground"
                    aria-label={expanded ? `Collapse ${group.label}` : `Expand ${group.label}`}
                    aria-expanded={expanded}
                  >
                    <ChevronDown
                      className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
              </div>
              {expanded && group.items && (
                <ul className="ml-3 mt-1 mb-2 border-l border-border/70 space-y-0.5">
                  {group.items.map((item) => (
                    <li key={`${group.label}-${item}`}>
                      <button
                        onClick={() => onChange(item)}
                        className={`block w-full text-left pl-3 py-1 text-[13px] transition-colors ${
                          isActive(item)
                            ? 'text-primary font-semibold'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        data-testid={`rail-item-${item.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                      >
                        {item}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export { RAIL_GROUP_LABELS };
