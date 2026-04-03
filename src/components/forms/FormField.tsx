/**
 * Shkad Aadel — Form Field Component
 * 
 * RTL-ready form field with label, error state, and validation feedback.
 * Uses design system tokens exclusively.
 */

import * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  label,
  htmlFor,
  error,
  required,
  hint,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label
        htmlFor={htmlFor}
        className={cn(
          'font-display text-sm font-medium',
          error && 'text-destructive'
        )}
      >
        {label}
        {required && (
          <span className="text-destructive ms-1" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {children}
      {hint && !error && (
        <p className="text-xs text-muted-foreground" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p
          className="text-xs text-destructive animate-fade-in"
          id={`${htmlFor}-error`}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
