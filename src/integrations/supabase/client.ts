// Supabase is optional.
// This project runs in Standalone/API mode by default.
// If you want Supabase mode again, re-introduce @supabase/supabase-js and wire this file.

type DummyResult<T> = Promise<{ data: T | null; error: any | null }>;

function disabled(): never {
  throw new Error('Supabase mode is disabled in this standalone build. Use VITE_API_BASE_URL.');
}

export const supabase: any = {
  rpc: () => disabled(),
  from: () => ({
    select: (): DummyResult<any> => Promise.reject(disabled()),
    insert: (): DummyResult<any> => Promise.reject(disabled()),
    update: (): DummyResult<any> => Promise.reject(disabled()),
    delete: (): DummyResult<any> => Promise.reject(disabled()),
    upsert: (): DummyResult<any> => Promise.reject(disabled()),
    eq: () => ({ select: (): DummyResult<any> => Promise.reject(disabled()) }),
  }),
  auth: {
    getSession: () => Promise.reject(disabled()),
    signUp: () => Promise.reject(disabled()),
    signInWithPassword: () => Promise.reject(disabled()),
    signOut: () => Promise.reject(disabled()),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    refreshSession: () => Promise.reject(disabled()),
  },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  removeChannel: () => Promise.resolve(),
};
