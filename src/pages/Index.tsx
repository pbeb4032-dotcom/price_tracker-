import { Link } from 'react-router-dom';
import { RTLLayout, PageContainer } from '@/components/layout';
import { Shield, TrendingDown, MapPin, Users, BarChart3, Bell } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { useSeoMeta } from '@/lib/seo/useSeoMeta';
import { ExchangeRateWidget } from '@/components/ExchangeRateWidget';

const features = [
  {
    icon: TrendingDown,
    title: 'أسعار عادلة',
    description: 'تقارير أسعار مباشرة من المجتمع لتمكينك من الشراء بأفضل سعر.',
  },
  {
    icon: MapPin,
    title: 'تغطية كل المناطق',
    description: 'بيانات أسعار من جميع المحافظات والمدن العراقية.',
  },
  {
    icon: Users,
    title: 'مدعوم من المجتمع',
    description: 'نظام تصويت وتحقق يضمن دقة وموثوقية البيانات.',
  },
  {
    icon: BarChart3,
    title: 'تحليلات ذكية',
    description: 'رصد اتجاهات الأسعار والتنبؤ بالتغييرات.',
  },
  {
    icon: Bell,
    title: 'تنبيهات فورية',
    description: 'احصل على إشعارات عند انخفاض أسعار المنتجات التي تهمك.',
  },
  {
    icon: Shield,
    title: 'بيانات موثوقة',
    description: 'نظام إشراف متقدم يحمي من البيانات المضللة.',
  },
];

const Index = () => {
  const { user } = useAuth();

  useSeoMeta({
    title: 'شكد عادل',
    description: 'منصة مجتمعية لمعرفة الأسعار العادلة للمنتجات في العراق — رصد وتحليل ومقارنة أسعار السوق.',
  });

  return (
    <RTLLayout>
      {/* Hero Section */}
      <header className="relative overflow-hidden bg-primary">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0 bg-gradient-to-b from-primary to-primary/80" />
        </div>
        <PageContainer className="relative py-16 md:py-24 lg:py-32">
          <div className="max-w-3xl">
            <h1 className="text-primary-foreground mb-6 leading-tight">
              <span className="block text-lg md:text-xl font-medium opacity-80 mb-2">
                شكد عادل؟
              </span>
              ذكاء الأسعار العادلة في العراق
            </h1>
            <p className="text-primary-foreground/80 text-lg md:text-xl leading-relaxed max-w-2xl mb-8">
              منصة مجتمعية تمكّن المستهلك العراقي من معرفة الأسعار الحقيقية
              للمنتجات في منطقته، ومقارنتها مع المناطق الأخرى.
            </p>
            <div className="flex flex-wrap gap-4">
              {user ? (
                <Button asChild size="lg" variant="secondary">
                  <Link to="/dashboard">لوحة التحكم</Link>
                </Button>
              ) : (
                <>
                  <Button asChild size="lg" className="bg-primary-foreground text-primary hover:bg-primary-foreground/90">
                    <Link to="/sign-up">إنشاء حساب مجاني</Link>
                  </Button>
                   <Button asChild size="lg" variant="secondary">
                     <Link to="/sign-in">تسجيل الدخول</Link>
                  </Button>
                </>
              )}
               <Button asChild size="lg" variant="secondary">
                 <Link to="/prices">تصفح الأسعار الموثّقة</Link>
              </Button>
            </div>
          </div>
        </PageContainer>
      </header>

      {/* Exchange Rate Widget */}
      <section className="py-8 md:py-12 bg-muted/30">
        <PageContainer>
          <div className="max-w-lg mx-auto">
            <ExchangeRateWidget />
          </div>
        </PageContainer>
      </section>

      {/* Features Grid */}
      <section className="py-16 md:py-24">
        <PageContainer>
          <div className="text-center mb-12 md:mb-16">
            <h2 className="text-foreground mb-4">كيف يعمل شكد عادل؟</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              منصة مفتوحة تعتمد على تقارير المجتمع لبناء قاعدة بيانات أسعار
              شفافة وموثوقة.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {features.map((feature) => (
              <article
                key={feature.title}
                className="group bg-card border border-border rounded-lg p-6 transition-all hover:shadow-md hover:border-primary/30"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <feature.icon className="h-6 w-6" aria-hidden="true" />
                </div>
                <h3 className="text-xl text-card-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </article>
            ))}
          </div>
        </PageContainer>
      </section>

      {/* Stats placeholder */}
      <section className="bg-secondary py-12 md:py-16">
        <PageContainer>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { value: '١٨', label: 'محافظة' },
              { value: '+٥٠٠', label: 'منتج' },
              { value: '٢٤/٧', label: 'تحديث مستمر' },
              { value: '١٠٠٪', label: 'مجاني' },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="font-display text-3xl md:text-4xl font-bold text-primary mb-1">
                  {stat.value}
                </div>
                <div className="text-secondary-foreground text-sm md:text-base">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </PageContainer>
      </section>

    </RTLLayout>
  );
};

export default Index;
