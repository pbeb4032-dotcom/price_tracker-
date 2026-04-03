/**
 * Offer reliability badge (trusted / medium / suspected) with explainable tooltip.
 *
 * This is intentionally lightweight and tolerant of missing backend fields.
 */

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type ReliabilityBadge = 'trusted' | 'medium' | 'suspected';

export interface OfferReliabilityBadgeProps {
  badge?: ReliabilityBadge | string | null;
  /** 0..1 */
  confidence?: number | null;
  reasons?: string[] | null;
  className?: string;
}

function normalizeBadge(v: OfferReliabilityBadgeProps['badge']): ReliabilityBadge {
  const s = String(v ?? '').toLowerCase().trim();
  if (s === 'trusted' || s === 'high' || s === 'ok' || s === 'green') return 'trusted';
  if (s === 'suspected' || s === 'anomaly' || s === 'bad' || s === 'red') return 'suspected';
  return 'medium';
}

const CFG: Record<ReliabilityBadge, { label: string; cls: string }>= {
  trusted: {
    label: 'موثوق',
    cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  },
  medium: {
    label: 'متوسط',
    cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20',
  },
  suspected: {
    label: 'مشتبه',
    cls: 'bg-destructive/15 text-destructive border-destructive/20',
  },
};

export function OfferReliabilityBadge({ badge, confidence, reasons, className }: OfferReliabilityBadgeProps) {
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
          title={cfg.label}
        >
          {key === 'trusted' ? '✅' : key === 'suspected' ? '🔴' : '🟡'}
          {cfg.label}{pctText ? ` ${pctText}` : ''}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="text-xs leading-relaxed space-y-1">
          <div className="font-medium">موثوقية السعر</div>
          <div className="text-muted-foreground">
            {pctText ? `مستوى الثقة: ${pctText}` : 'مستوى الثقة: غير متوفر'}
          </div>
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
