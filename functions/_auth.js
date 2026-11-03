// Shared by the /api functions: the single admin login and its signed session cookie.

const COOKIE_NAME = 'wf_admin';
const SESSION_SECONDS = 8 * 60 * 60;

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

// Changes can only come from the admin page on this site.
export function isSameOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin;
}

export function isAuthConfigured(env) {
  return !!(env.ADMIN_USERNAME && env.ADMIN_PASSWORD && env.SESSION_SECRET);
}

function bytesToBase64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// Hashing first means the comparison takes the same time whatever was typed.
async function sameText(a, b) {
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(hashA);
  const bytesB = new Uint8Array(hashB);
  let difference = 0;
  for (let i = 0; i < bytesA.length; i++) difference |= bytesA[i] ^ bytesB[i];
  return difference === 0;
}

export async function credentialsMatch(env, username, password) {
  const results = await Promise.all([sameText(username, env.ADMIN_USERNAME), sameText(password, env.ADMIN_PASSWORD)]);
  return results.every(Boolean);
}

// Includes the password, so changing it signs everyone out.
function signingKey(env) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SESSION_SECRET + ':' + env.ADMIN_PASSWORD),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createSessionCookie(env) {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env), new TextEncoder().encode(payload));
  const token = payload + '.' + bytesToBase64Url(signature);
  return COOKIE_NAME + '=' + token + '; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=' + SESSION_SECONDS;
}

export function clearSessionCookie() {
  return COOKIE_NAME + '=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}

export async function isSignedIn(request, env) {
  if (!isAuthConfigured(env)) return false;
  const cookies = (request.headers.get('Cookie') || '').split(/;\s*/);
  const cookie = cookies.find((item) => item.startsWith(COOKIE_NAME + '='));
  if (!cookie) return false;
  try {
    const [payload, signature] = cookie.slice(COOKIE_NAME.length + 1).split('.');
    const valid = await crypto.subtle.verify('HMAC', await signingKey(env), base64UrlToBytes(signature), new TextEncoder().encode(payload));
    if (!valid) return false;
    const { exp } = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
    return typeof exp === 'number' && exp > Date.now() / 1000;
  } catch (e) {
    return false;
  }
}
