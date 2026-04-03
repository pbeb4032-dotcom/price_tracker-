// Simple global token getter used by the API client.
// AuthProvider (Clerk mode) will inject a getter that returns a fresh JWT.

let tokenGetter: (() => Promise<string | null>) | null = null;

export function setApiTokenGetter(fn: (() => Promise<string | null>) | null) {
  tokenGetter = fn;
}

export async function getApiToken(): Promise<string | null> {
  return tokenGetter ? tokenGetter() : null;
}
