// Shared helper: get authenticated user from either cookies or Authorization: Bearer header.
// Supports both browser (SSR cookies) and headless clients (scripts, tests, agent worker).

import { NextRequest } from 'next/server';
import { createClient } from './server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export async function getUserFromRequest(req: NextRequest) {
  // 1. Try cookie-based session (browser / SSR)
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!error && user) return { user, supabase };

  // 2. Fall back to Authorization: Bearer <token> (scripts, API clients, e2e tests)
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    // Create a client that sends the JWT in every request header,
    // so PostgREST can evaluate auth.uid() for RLS policies.
    const bearerClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );

    // Validate the token and get user
    const { data: { user: tokenUser }, error: tokenError } = await bearerClient.auth.getUser(token);
    if (!tokenError && tokenUser) {
      return { user: tokenUser, supabase: bearerClient };
    }
  }

  return { user: null, supabase };
}
