/**
 * Shkad Aadel — Dashboard (Protected)
 */

import { useNavigate } from 'react-router-dom';

import { RTLLayout, PageContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/AuthProvider';
import TrustedPriceSummaryCard from '@/components/TrustedPriceSummaryCard';
import { useSeoMeta } from '@/lib/seo/useSeoMeta';

export default function Dashboard() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  useSeoMeta({
    title: 'لوحة التحكم',
    description: 'لوحة التحكم الخاصة بك في شكد عادل.',
    noindex: true,
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/sign-in', { replace: true });
  };

  return (
    <RTLLayout>
      <PageContainer className="py-12">
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-bold text-foreground mb-4">
            مرحباً{profile?.display_name ? ` ${profile.display_name}` : ''}
          </h1>
          <p className="text-muted-foreground text-lg">
            لوحة التحكم
          </p>
        </div>

        <div className="max-w-2xl mx-auto">
          <TrustedPriceSummaryCard />
        </div>
      </PageContainer>
    </RTLLayout>
  );
}
