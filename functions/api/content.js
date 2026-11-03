// Cloudflare Pages Function, served at /api/content. Used only by the admin page.
//   GET  returns the latest this-week.txt from GitHub.
//   PUT  commits a new version, refusing it if someone else has published in the meantime.
//
// Every request must carry a valid admin session. If anything is missing or not set up,
// the request is refused.
//
// Settings (Cloudflare project > Settings > Variables and Secrets):
//   ADMIN_USERNAME   secret: the admin login name
//   ADMIN_PASSWORD   secret: the admin password
//   SESSION_SECRET   secret: long random text used to sign logins
//   GITHUB_REPO      e.g. willowfieldchurch/sunday-page
//   GITHUB_TOKEN     secret: fine-grained token with Contents read/write on that repository only
//   GITHUB_BRANCH    optional, defaults to main
// Binding: LOGIN_ATTEMPTS, a KV namespace used to limit wrong passwords.

import { json, isSameOrigin, isSignedIn } from '../_auth.js';

const FILE_PATH = 'this-week.txt';
const MAX_BYTES = 200 * 1024;

function github(env, method, body) {
  const branch = env.GITHUB_BRANCH || 'main';
  const query = method === 'GET' ? '?ref=' + encodeURIComponent(branch) : '';
  return fetch('https://api.github.com/repos/' + env.GITHUB_REPO + '/contents/' + FILE_PATH + query, {
    method,
    headers: {
      Authorization: 'Bearer ' + env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'willowfield-sunday-page',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify({ ...body, branch }) : undefined,
  });
}

function textToBase64(text) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToText(content) {
  const bytes = Uint8Array.from(atob(content.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function onRequestGet({ request, env }) {
  if (!(await isSignedIn(request, env))) return json({ error: 'not_signed_in' }, 401);
  if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return json({ error: 'not_set_up' }, 500);

  const response = await github(env, 'GET');
  if (!response.ok) return json({ error: 'github_error', status: response.status }, 502);
  const file = await response.json();
  return json({ text: base64ToText(file.content), sha: file.sha });
}

export async function onRequestPut({ request, env }) {
  if (!(await isSignedIn(request, env))) return json({ error: 'not_signed_in' }, 401);
  if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return json({ error: 'not_set_up' }, 500);
  if (!isSameOrigin(request)) return json({ error: 'wrong_origin' }, 403);
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return json({ error: 'wrong_type' }, 415);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid_request' }, 400);
  }
  const { text, sha } = body || {};
  if (typeof text !== 'string' || typeof sha !== 'string' || !sha) return json({ error: 'invalid_request' }, 400);
  if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ error: 'too_large' }, 413);
  if (!/^# SUNDAY\s*$/m.test(text)) return json({ error: 'invalid_content' }, 400);

  const response = await github(env, 'PUT', {
    message: 'Update Sunday page',
    content: textToBase64(text),
    sha,
  });
  if (response.status === 409) return json({ error: 'conflict' }, 409);
  if (response.status === 422) {
    const detail = await response.json().catch(() => ({}));
    if (/sha/i.test(detail.message || '')) return json({ error: 'conflict' }, 409);
  }
  if (!response.ok) return json({ error: 'github_error', status: response.status }, 502);
  const saved = await response.json();
  return json({ sha: saved.content.sha });
}
