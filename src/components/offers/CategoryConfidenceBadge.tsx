/**
 * Category confidence badge (trusted / medium / weak) with explainable tooltip.
 *
 * This helps users understand if a product's category is solid or needs review.
 */

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type CategoryBadge = 'trusted' | 'medium' | 'weak';

export interface CategoryConfidenceBadgeProps {
  badge?: CategoryBadge | string | null;
  /** 0..1 */
  confidence?: number | null;
  reasons?: string[] | null;
  conflict?: boolean | null;
  className?: string;
}

function normalizeBadge(v: CategoryConfidenceBadgeProps['badge']): CategoryBadge {
  const s = String(v ?? '').toLowerCase().trim();
  if (s === 'trusted' || s === 'high' || s === 'ok' || s === 'green') return 'trusted';
  if (s === 'weak' || s === 'low' || s === 'bad' || s === 'red') return 'weak';
  return 'medium';
}

const CFG: Record<CategoryBadge, { label: string; cls: string }>= {
  trusted: {
    label: 'موثوق',
    cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  },
  medium: {
    label: 'متوسط',
    cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20',
  },
  weak: {
    label: 'ضعيف',
    cls: 'bg-muted text-muted-foreground border-border',
  },
};

export function CategoryConfidenceBadge({ badge, confidence, reasons, conflict, className }: CategoryConfidenceBadgeProps) {
  const key = normalizeBadge(badge);
  const cfg = CFG[key];
  const pct = typeof confidence === 'number' && Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : null;
  const pctText = pct == null ? null : `${Math.round(pct * 100)}%`;
  const rs = Array.isArray(reasons) ? reasons.filter(Boolean).slice(0, 4) : [];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn('text-[10px] font-normal gap-1', cfg.cls, className)}
          title="ثقة التصنيف"
        >
          {conflict ? '⚠️' : key === 'trusted' ? '✅' : key === 'weak' ? '⚪' : '🟡'}
          تصنيف {cfg.label}{pctText ? ` ${pctText}` : ''}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="text-xs leading-relaxed space-y-1">
          <div className="font-medium">ثقة التصنيف</div>
          <div className="text-muted-foreground">
            {pctText ? `مستوى الثقة: ${pctText}` : 'مستوى الثقة: غير متوفر'}
          </div>
          {conflict ? (
            <div className="text-destructive">يوجد تعارض بين دلائل التصنيف.</div>
          ) : null}
          {rs.length ? (
            <ul className="list-disc ps-4">
              {rs.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : (
            <div className="text-muted-foreground">لا توجد أسباب تفصيلية حالياً.</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
