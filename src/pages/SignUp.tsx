/**
 * Shkad Aadel — Sign Up Page
 *
 * RTL-first sign-up form with Zod validation, AppError display,
 * loading states, email confirmation flow, and telemetry.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, UserPlus, CheckCircle } from 'lucide-react';

import { RTLLayout, PageContainer } from '@/components/layout';
import { FormField } from '@/components/forms';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { signUpSchema, type SignUpInput } from '@/lib/validation/schemas';
import { useAuth } from '@/lib/auth/AuthProvider';
import { AppError } from '@/lib/errors';
import { useSeoMeta } from '@/lib/seo/useSeoMeta';

export default function SignUpPage() {
  const { signUp, loading } = useAuth();
  useSeoMeta({ title: 'إنشاء حساب', description: 'أنشئ حسابك في شكد عادل لمراقبة الأسعار.', noindex: true });
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
  });

  const onSubmit = async (data: SignUpInput) => {
    setServerError(null);
    try {
      await signUp(data.email, data.password, data.display_name);
      setSuccess(true);
    } catch (err) {
      if (err instanceof AppError) {
        setServerError(err.messageAr);
      } else {
        setServerError('حدث خطأ غير متوقع، يرجى المحاولة لاحقاً');
      }
    }
  };

  if (success) {
    return (
      <RTLLayout>
        <PageContainer className="flex min-h-screen items-center justify-center py-12">
          <div className="w-full max-w-md text-center">
            <div className="bg-card border border-border rounded-lg p-8 shadow-sm">
              <CheckCircle className="h-12 w-12 text-primary mx-auto mb-4" />
              <h1 className="font-display text-2xl font-bold text-foreground mb-3">
                تم إنشاء الحساب
              </h1>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                تم إرسال رابط التأكيد إلى بريدك الإلكتروني.
                <br />
                يرجى فتح الرابط لتفعيل حسابك.
              </p>
              <Link
                to="/sign-in"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-6 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                العودة لتسجيل الدخول
              </Link>
            </div>
          </div>
        </PageContainer>
      </RTLLayout>
    );
  }

  return (
    <RTLLayout>
      <PageContainer className="flex min-h-screen items-center justify-center py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="font-display text-3xl font-bold text-foreground mb-2">
              إنشاء حساب جديد
            </h1>
            <p className="text-muted-foreground">
              انضم إلى مجتمع شكد عادل لمراقبة الأسعار
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
              label="اسم العرض"
              htmlFor="display_name"
              error={errors.display_name?.message}
              required
            >
              <Input
                id="display_name"
                type="text"
                autoComplete="name"
                aria-describedby={errors.display_name ? 'display_name-error' : undefined}
                aria-invalid={!!errors.display_name}
                disabled={loading}
                {...register('display_name')}
              />
            </FormField>

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
              hint="يجب أن تكون 8 أحرف على الأقل"
            >
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                dir="ltr"
                className="text-start"
                aria-describedby={
                  errors.password
                    ? 'password-error'
                    : 'password-hint'
                }
                aria-invalid={!!errors.password}
                disabled={loading}
                {...register('password')}
              />
            </FormField>

            <Button type="submit" className="w-full gap-2" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {loading ? 'جاري إنشاء الحساب...' : 'إنشاء حساب'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              لديك حساب بالفعل؟{' '}
              <Link
                to="/sign-in"
                className="text-primary font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                تسجيل الدخول
              </Link>
            </p>
          </form>
        </div>
      </PageContainer>
    </RTLLayout>
  );
}
