/**
 * Empty state for no results / no data.
 */

import { Package, Search } from 'lucide-react';

interface EmptyStateProps {
  variant: 'no-results' | 'no-data';
  searchQuery?: string;
}

export function EmptyState({ variant, searchQuery }: EmptyStateProps) {
  const Icon = variant === 'no-results' ? Search : Package;

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      {variant === 'no-results' ? (
        <>
          <h3 className="text-lg font-medium text-foreground mb-2">
            لم يتم العثور على نتائج
          </h3>
          <p className="text-muted-foreground text-sm max-w-md">
            {searchQuery
              ? `لا توجد منتجات تطابق "${searchQuery}". جرّب كلمات بحث مختلفة.`
              : 'جرّب البحث بكلمة مختلفة أو تصفّح الفئات.'}
          </p>
        </>
      ) : (
        <>
          <h3 className="text-lg font-medium text-foreground mb-2">
            لا توجد عروض حالياً
          </h3>
          <p className="text-muted-foreground text-sm max-w-md">
            يتم تحديث البيانات بشكل مستمر من المصادر العراقية.
            تحقق لاحقاً للاطلاع على أحدث العروض.
          </p>
        </>
      )}
    </div>
  );
}
