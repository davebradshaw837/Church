// Cloudflare Pages Function, served at /api/logout.

import { json, isSameOrigin, clearSessionCookie } from '../_auth.js';

export async function onRequestPost({ request }) {
  if (!isSameOrigin(request)) return json({ error: 'wrong_origin' }, 403);
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}
