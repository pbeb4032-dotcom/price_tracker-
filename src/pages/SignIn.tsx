/**
 * Shkad Aadel — Sign In Page
 *
 * RTL-first sign-in form with Zod validation, AppError display,
 * loading states, and telemetry integration.
 */

import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, LogIn } from 'lucide-react';

import { RTLLayout, PageContainer } from '@/components/layout';
import { FormField } from '@/components/forms';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { signInSchema, type SignInInput } from '@/lib/validation/schemas';
import { useAuth } from '@/lib/auth/AuthProvider';
import { AppError } from '@/lib/errors';
import { useSeoMeta } from '@/lib/seo/useSeoMeta';

export default function SignInPage() {
  const { signIn, loading } = useAuth();
  useSeoMeta({ title: 'تسجيل الدخول', description: 'سجّل دخولك إلى شكد عادل.', noindex: true });
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);

  const from = (location.state as { from?: string })?.from ?? '/';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
  });

  const onSubmit = async (data: SignInInput) => {
    setServerError(null);
    try {
      await signIn(data.email, data.password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof AppError) {
        setServerError(err.messageAr);
      } else {
        setServerError('حدث خطأ غير متوقع، يرجى المحاولة لاحقاً');
      }
    }
  };

  return (
    <RTLLayout>
      <PageContainer className="flex min-h-screen items-center justify-center py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="font-display text-3xl font-bold text-foreground mb-2">
              تسجيل الدخول
            </h1>
            <p className="text-muted-foreground">
              أدخل بريدك الإلكتروني وكلمة المرور للدخول
            </p>
          </div>

          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-5 bg-card border border-border rounded-lg p-6 shadow-sm"
            noValidate
          >
            {serverError && (
              <div
                className="bg-destructive/10 border border-destructive/30 rounded-md p-3 text-sm text-destructive animate-fade-in"
                role="alert"
              >
                {serverError}
              </div>
            )}

            <FormField
              label="البريد الإلكتروني"
              htmlFor="email"
              error={errors.email?.message}
              required
            >
              <Input
                id="email"
                type="email"
                autoComplete="email"
                dir="ltr"
                className="text-start"
                aria-describedby={errors.email ? 'email-error' : undefined}
                aria-invalid={!!errors.email}
                disabled={loading}
                {...register('email')}
              />
            </FormField>

            <FormField
              label="كلمة المرور"
              htmlFor="password"
              error={errors.password?.message}
              required
            >
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                dir="ltr"
                className="text-start"
                aria-describedby={errors.password ? 'password-error' : undefined}
                aria-invalid={!!errors.password}
                disabled={loading}
                {...register('password')}
              />
            </FormField>

            <Button type="submit" className="w-full gap-2" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {loading ? 'جاري الدخول...' : 'دخول'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              ليس لديك حساب؟{' '}
              <Link
                to="/sign-up"
                className="text-primary font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                إنشاء حساب
              </Link>
            </p>
          </form>
        </div>
      </PageContainer>
    </RTLLayout>
  );
}
