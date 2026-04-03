const env = (import.meta as any).env ?? {};

export const USE_API = Boolean(env.VITE_API_BASE_URL || env.VITE_API_URL);
export const USE_CLERK = Boolean((import.meta as any).env?.VITE_CLERK_PUBLISHABLE_KEY);
