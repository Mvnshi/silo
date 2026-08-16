/**
 * Accounts — optional identity, never a gate.
 *
 * ## The model
 *
 * Silo works completely signed-out: every save lives on the device, and the
 * app has no idea who you are. Signing in buys exactly one thing — a **stable
 * space key** — which is what lets the phone and the browser extension find
 * each other without typing a pairing code, and what makes a restore possible
 * after a reinstall. That is `docs/sync.md`'s "Mode 2", which the Worker
 * already understands via `REQUIRE_AUTH`.
 *
 * ## What the identity provider does and doesn't see
 *
 * Supabase issues and verifies the identity. It never receives a save: titles,
 * URLs, screenshots, notes and tags go to YOUR Cloudflare Worker + D1, keyed by
 * `spaceKey = user.id`. So the privacy claim in the README survives an account
 * — the auth vendor holds an email address and a UUID, nothing else.
 *
 * ## Degradation contract (important)
 *
 * If `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are unset —
 * a fresh clone, a self-hoster, CI — every function here resolves to a
 * signed-out no-op and `isAuthConfigured()` is false. The UI hides the account
 * surface entirely rather than showing buttons that can't work. Nothing throws.
 */
import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** True when this build has an identity provider wired up. */
export function isAuthConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

/**
 * Created on first use, not at import: an unconfigured build must not construct
 * a client (and `createClient` is a meaningful chunk of JS to evaluate on a
 * cold start that may never need it).
 */
let client: SupabaseClient | null = null;

function supabase(): SupabaseClient | null {
  if (!isAuthConfigured()) return null;
  if (client) return client;
  // Required for the ESM/CJS interop in the RN bundler.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // RN has no URL bar to read a callback fragment from; we hand the code to
      // `exchangeCodeForSession` ourselves in `completeOAuth`.
      detectSessionInUrl: false,
    },
  });
  return client;
}

export type AuthResult = { ok: true } | { ok: false; message: string };

const NOT_CONFIGURED: AuthResult = {
  ok: false,
  message: 'Accounts aren’t set up in this build.',
};

/* ---------------------------------------------------------------------------
 * Session
 * ------------------------------------------------------------------------- */

export async function getSession(): Promise<Session | null> {
  const sb = supabase();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data.session ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to sign-in / sign-out / token-refresh. Returns an unsubscribe fn,
 * and a no-op unsubscribe when auth is off, so callers never branch.
 */
export function onAuthChange(handler: (session: Session | null) => void): () => void {
  const sb = supabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => handler(session));
  return () => data.subscription.unsubscribe();
}

/**
 * The bearer token for Worker calls. `getSession()` refreshes it when expired,
 * so callers get a live token rather than a stale one.
 */
export async function getAccessToken(): Promise<string | null> {
  return (await getSession())?.access_token ?? null;
}

/** The stable sync space for the signed-in user — `docs/sync.md` Mode 2. */
export function spaceKeyFor(user: User | null | undefined): string | null {
  return user?.id ?? null;
}

export function displayName(user: User | null | undefined): string {
  if (!user) return 'You';
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const full = typeof meta?.full_name === 'string' ? meta.full_name.trim() : '';
  if (full) return full;
  return user.email?.split('@')[0] ?? 'You';
}

/* ---------------------------------------------------------------------------
 * Sign in with Apple
 *
 * Native, not OAuth-through-a-browser. Apple's own sheet is one tap, it's what
 * iOS users expect, and — unlike the web flow — it needs no 6-monthly secret
 * rotation. It is also an App Store requirement: an app offering third-party
 * sign-in must offer Apple's too.
 * ------------------------------------------------------------------------- */

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios' || !isAuthConfigured()) return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function signInWithApple(): Promise<AuthResult> {
  const sb = supabase();
  if (!sb) return NOT_CONFIGURED;
  try {
    // The nonce is bound to the credential: Apple hashes it into the token, and
    // Supabase re-derives it, so a stolen token can't be replayed.
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce
    );

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) {
      return { ok: false, message: 'Apple didn’t return a sign-in token.' };
    }

    const { error } = await sb.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) return { ok: false, message: error.message };

    // Apple sends the full name exactly once, on first authorization. Persist
    // it now or it is gone forever.
    const name = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (name) await sb.auth.updateUser({ data: { full_name: name } }).catch(() => {});

    return { ok: true };
  } catch (error) {
    // The user backing out of Apple's sheet is not an error worth surfacing.
    if (isCancellation(error)) return { ok: false, message: '' };
    return { ok: false, message: readableError(error) };
  }
}

/* ---------------------------------------------------------------------------
 * Google (and any other OAuth provider) — browser round-trip + PKCE
 * ------------------------------------------------------------------------- */

export async function signInWithGoogle(): Promise<AuthResult> {
  const sb = supabase();
  if (!sb) return NOT_CONFIGURED;
  try {
    const redirectTo = Linking.createURL('/auth/callback');
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) return { ok: false, message: error.message };
    if (!data?.url) return { ok: false, message: 'Couldn’t start Google sign-in.' };

    // Auth session — keeps the flow inside the app and hands us the callback
    // rather than dumping the user in Safari.
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return { ok: false, message: '' };

    return await completeOAuth(result.url);
  } catch (error) {
    return { ok: false, message: readableError(error) };
  }
}

/** Exchange the `?code=` on an OAuth callback URL for a session. */
export async function completeOAuth(url: string): Promise<AuthResult> {
  const sb = supabase();
  if (!sb) return NOT_CONFIGURED;
  try {
    const code = new URL(url).searchParams.get('code');
    if (!code) return { ok: false, message: 'That sign-in link was incomplete.' };
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: readableError(error) };
  }
}

/* ---------------------------------------------------------------------------
 * Email — a six-digit code, not a password
 *
 * No password field anywhere in Silo. Passwords mean a reset flow, a strength
 * meter, a breach surface and a forgotten-password support load, to protect a
 * library that also exists on the device. A one-time code is fewer screens and
 * strictly less to lose.
 * ------------------------------------------------------------------------- */

export async function sendEmailCode(email: string): Promise<AuthResult> {
  const sb = supabase();
  if (!sb) return NOT_CONFIGURED;
  const address = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(address)) {
    return { ok: false, message: 'That doesn’t look like an email address.' };
  }
  try {
    const { error } = await sb.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: readableError(error) };
  }
}

export async function verifyEmailCode(email: string, code: string): Promise<AuthResult> {
  const sb = supabase();
  if (!sb) return NOT_CONFIGURED;
  try {
    const { error } = await sb.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    });
    if (error) {
      // Supabase's own copy here is "Token has expired or is invalid".
      return { ok: false, message: 'That code didn’t work. Check it and try again.' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: readableError(error) };
  }
}

/* ---------------------------------------------------------------------------
 * Leaving
 * ------------------------------------------------------------------------- */

/**
 * Sign out. Saves stay on the device — this drops the session and the synced
 * space, not the library. The UI must say so.
 */
export async function signOut(): Promise<AuthResult> {
  const sb = supabase();
  if (!sb) return { ok: true };
  try {
    const { error } = await sb.auth.signOut();
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: readableError(error) };
  }
}

/**
 * Delete the account.
 *
 * Deliberately server-side: the anon key cannot delete a user, and shipping a
 * service-role key in the client would hand every install god-mode over the
 * whole user table. The Worker performs the deletion (its own space rows plus
 * the Supabase admin call) after verifying the caller's token.
 *
 * Returns `ok: false` with a plain message if the endpoint isn't deployed, so
 * the UI can say "not available yet" instead of pretending it worked.
 */
export async function deleteAccount(apiBaseUrl: string, clientToken: string): Promise<AuthResult> {
  const token = await getAccessToken();
  if (!token) return { ok: false, message: 'You’re not signed in.' };
  if (!apiBaseUrl) return { ok: false, message: 'No server configured for this build.' };
  try {
    const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/account`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Silo-Client': clientToken,
      },
      // Cast: importing the Supabase types pulls DOM's AbortSignal into scope,
      // which RN's fetch typing doesn't accept. Runtime is identical.
      signal: timeoutSignal(15000) as RequestInit['signal'],
    });
    if (!res.ok) {
      return { ok: false, message: `Couldn’t delete the account (${res.status}).` };
    }
    await signOut();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: readableError(error) };
  }
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

/**
 * A signal that aborts after `ms`. React Native polyfills AbortSignal from the
 * `abort-controller` package, which predates the `timeout` static — calling it
 * unguarded would throw on every request. Mirrors lib/api.ts.
 */
function timeoutSignal(ms: number): AbortSignal {
  const ctor = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof ctor.timeout === 'function') return ctor.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function isCancellation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED';
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/network|fetch|timeout|abort/i.test(message)) {
    return 'Couldn’t reach the server. Check your connection.';
  }
  return message || 'Something went wrong. Try again.';
}
