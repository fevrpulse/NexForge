import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://nfaxokwpmaxyhnvatrwf.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mYXhva3dwbWF4eWhudmF0cndmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NDc3NTcsImV4cCI6MjA5NDEyMzc1N30.22fLTgCxh5ne9zrod9gc2-idnw6biFUIDNZLEZkJUSk';

export function createSbClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // Avoid hanging forever on a dead refresh token during boot.
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
    global: {
      headers: {
        'X-Client-Info': 'nexforge-desktop',
      },
    },
  });
}

export const sb = createSbClient();
