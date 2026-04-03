import { Link } from 'react-router-dom';
import { RTLLayout, PageContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Home, BarChart3 } from 'lucide-react';
import { useSeoMeta } from '@/lib/seo/useSeoMeta';

const NotFound = () => {
  useSeoMeta({ title: 'الصفحة غير موجودة', description: 'الصفحة التي تبحث عنها غير متاحة.', noindex: true });
  return (
    <RTLLayout>
      <PageContainer className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center max-w-md">
          <div className="font-display text-8xl font-bold text-primary/20 mb-4">٤٠٤</div>
          <h1 className="text-2xl font-bold text-foreground mb-3">
            عذراً، الصفحة غير موجودة
          </h1>
          <p className="text-muted-foreground mb-8">
            الصفحة التي تبحث عنها غير متاحة أو تم نقلها.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="gap-2">
              <Link to="/">
                <Home className="h-4 w-4" />
                العودة للرئيسية
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2">
              <Link to="/prices">
                <BarChart3 className="h-4 w-4" />
                الانتقال إلى الأسعار
              </Link>
            </Button>
          </div>
        </div>
      </PageContainer>
    </RTLLayout>
  );
};

export default NotFound;
