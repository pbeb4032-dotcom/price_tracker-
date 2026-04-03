/**
 * Horizontal scrolling category tabs.
 */

import { PRODUCT_CATEGORIES, type CategoryKey } from '@/lib/offers/types';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface CategoryTabsProps {
  active: CategoryKey;
  onChange: (key: CategoryKey) => void;
}

export function CategoryTabs({ active, onChange }: CategoryTabsProps) {
  return (
    <ScrollArea className="w-full" dir="rtl">
      <div className="flex gap-2 pb-2 px-1">
        {PRODUCT_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => onChange(cat.key)}
            className={cn(
              'shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all',
              'border border-border hover:border-primary/40',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              active === cat.key
                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                : 'bg-card text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            aria-pressed={active === cat.key}
          >
            {cat.label_ar}
          </button>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
