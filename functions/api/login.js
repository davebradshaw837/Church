// Cloudflare Pages Function, served at /api/login.
// Each network address gets MAX_FAILURES wrong attempts, then must wait LOCKOUT_SECONDS.

import { json, isSameOrigin, isAuthConfigured, credentialsMatch, createSessionCookie } from '../_auth.js';

const MAX_FAILURES = 10;
const LOCKOUT_SECONDS = 15 * 60;

export async function onRequestPost({ request, env }) {
  if (!isSameOrigin(request)) return json({ error: 'wrong_origin' }, 403);
  // Logins are refused altogether if the attempt limit isn't available.
  if (!isAuthConfigured(env) || !env.LOGIN_ATTEMPTS) return json({ error: 'not_set_up' }, 500);

  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const attemptsKey = 'failures:' + address;
  const failures = Number(await env.LOGIN_ATTEMPTS.get(attemptsKey)) || 0;
  if (failures >= MAX_FAILURES) return json({ error: 'too_many_attempts' }, 429);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid_request' }, 400);
  }
  const { username, password } = body || {};
  if (typeof username !== 'string' || typeof password !== 'string') return json({ error: 'invalid_request' }, 400);

  if (!(await credentialsMatch(env, username, password))) {
    await env.LOGIN_ATTEMPTS.put(attemptsKey, String(failures + 1), { expirationTtl: LOCKOUT_SECONDS });
    return json({ error: 'wrong_login' }, 401);
  }

  await env.LOGIN_ATTEMPTS.delete(attemptsKey);
  return json({ ok: true }, 200, { 'Set-Cookie': await createSessionCookie(env) });
}
