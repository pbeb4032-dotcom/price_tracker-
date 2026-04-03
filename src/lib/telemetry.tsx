/**
 * Shkad Aadel — Telemetry Hooks
 * 
 * Pluggable telemetry provider. Default: console logger.
 * Replace provider for production (Sentry, PostHog, etc.)
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { AppError } from '@/lib/errors';

export interface TelemetryClient {
  trackEvent(name: string, properties?: Record<string, unknown>): void;
  trackError(error: AppError): void;
  setUser(userId: string): void;
}

const consoleTelemetry: TelemetryClient = {
  trackEvent(name, properties) {
    if (import.meta.env.DEV) {
      console.log(`[telemetry:event] ${name}`, properties);
    }
  },
  trackError(error) {
    console.error(`[telemetry:error] ${error.code}`, {
      message: error.message,
      context: error.context,
    });
  },
  setUser(userId) {
    if (import.meta.env.DEV) {
      console.log(`[telemetry:user] ${userId}`);
    }
  },
};

const TelemetryContext = createContext<TelemetryClient>(consoleTelemetry);

export function TelemetryProvider({
  provider = consoleTelemetry,
  children,
}: {
  provider?: TelemetryClient;
  children: ReactNode;
}) {
  return (
    <TelemetryContext.Provider value={provider}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry(): TelemetryClient {
  return useContext(TelemetryContext);
}
