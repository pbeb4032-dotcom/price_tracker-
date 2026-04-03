/**
 * Shkad Aadel — RTL Layout Component
 * 
 * Main layout wrapper that sets RTL direction and provides
 * consistent page structure.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import AppNavbar from '@/components/AppNavbar';
import AppFooter from '@/components/layout/AppFooter';

interface RTLLayoutProps {
  children: React.ReactNode;
  className?: string;
  dir?: 'rtl' | 'ltr';
  hideNavbar?: boolean;
  hideFooter?: boolean;
}

export function RTLLayout({ children, className, dir = 'rtl', hideNavbar = false, hideFooter = false }: RTLLayoutProps) {
  return (
    <div dir={dir} className={cn('min-h-screen flex flex-col bg-background text-foreground font-body', className)}>
      {!hideNavbar && <AppNavbar />}
      <div className="flex-1">{children}</div>
      {!hideFooter && <AppFooter />}
    </div>
  );
}

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
  as?: 'main' | 'section' | 'div';
}

export function PageContainer({
  children,
  className,
  as: Component = 'main',
}: PageContainerProps) {
  return (
    <Component
      className={cn(
        'container mx-auto px-4 py-6 md:px-6 lg:px-8',
        className
      )}
    >
      {children}
    </Component>
  );
}
