// Admin-only: sends a Supabase Auth invite email. The service-role key never leaves the server.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: isAdmin, error: roleError } = await caller.rpc('is_admin');
  if (roleError || !isAdmin) return reply(403, { error: 'Only admins can invite volunteers.' });

  let body: { email?: string; full_name?: string; redirect_to?: string };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Invalid request.' });
  }
  const email = body.email?.trim().toLowerCase() ?? '';
  const fullName = body.full_name?.trim() ?? '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Please enter a valid email address.' });
  if (!fullName) return reply(400, { error: 'Please enter the volunteer’s name.' });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: body.redirect_to,
  });
  if (error) {
    const exists = /already/i.test(error.message);
    return reply(exists ? 409 : 400, {
      error: exists ? 'Someone with that email already has an account.' : error.message,
    });
  }
  return reply(200, { id: data.user?.id });
});
