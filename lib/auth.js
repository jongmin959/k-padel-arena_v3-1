import { supabase } from "./supabaseClient";

/*
 * The sign-up form asks for a username + password, not an email — but
 * Supabase Auth's password flow is email-based. We bridge the two with
 * a synthetic email: `${username}@padelconnect.invalid`.
 *
 * Why `.invalid` specifically: it's a TLD reserved by RFC 2606 that is
 * guaranteed to never resolve or accept mail. That means even if a
 * Supabase system email were ever misdirected there, it cannot reach a
 * real mailbox anyone else controls. (Do NOT use a domain you don't
 * own, like `.com`/`.local` — `.invalid` is the only safe placeholder.)
 *
 * This gives every user a REAL Supabase Auth session and a real
 * bcrypt-hashed password managed entirely by Supabase — RLS's
 * auth.uid() works correctly, unlike the old DIY SHA-256 column.
 *
 * Trade-off (documented, not hidden): because the auth email isn't a
 * real inbox, Supabase's built-in "forgot password" email flow can't
 * reach the user. Two things soften this:
 *   1. `changePassword()` below lets a signed-in user change their own
 *      password at any time (no email needed).
 *   2. `profiles.email` stores a REAL recovery email (optional, from
 *      the sign-up form) for a future admin-assisted or custom
 *      email-based reset flow — see MIGRATION_GUIDE.md.
 */

const AUTH_EMAIL_DOMAIN = "padelconnect.invalid";

function usernameToAuthEmail(username) {
  return `${username.trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
}

/* Supabase Auth's default minimum password length. */
export const MIN_PASSWORD_LENGTH = 6;
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/* Sign-up only: the synthetic auth email cannot hold non-ASCII characters,
   so usernames are limited to a-z, 0-9 and _. Login never applies this
   check, so accounts created under any earlier rule can still sign in. */
export function validateUsername(username) {
  return USERNAME_PATTERN.test((username || "").trim().toLowerCase());
}

/*
 * The ONE place a profile row is created. It is idempotent:
 *   - if a profile already exists for this auth user (for example a
 *     database trigger created it, or an earlier attempt succeeded), nothing
 *     is inserted;
 *   - otherwise it inserts one, using the username/name saved in the auth
 *     user's metadata at sign-up. That also repairs an account whose profile
 *     insert failed after the auth user was created.
 * Works with the existing RLS policy "profiles_insert_self".
 */
export async function ensureProfile(user, overrides = {}) {
  const { data: existing } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (existing) return { created: false };

  const meta = user.user_metadata || {};
  const username = (overrides.username || meta.username || "").trim().toLowerCase();
  const displayName = overrides.name || meta.display_name || username;
  if (!username) return { error: { message: "profile_missing" } };

  const { error } = await supabase.from("profiles").insert({
    id: user.id,
    username,
    display_name: displayName,
    level: 3.0,
  });
  if (error) {
    if (error.code === "23505") {
      const { data: again } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
      if (again) return { created: false };
      return { error: { message: "duplicate_username" } };
    }
    return { error };
  }
  return { created: true };
}

export async function signUpWithUsername({ username, password, name }) {
  const normalizedUsername = (username || "").trim().toLowerCase();
  if (!validateUsername(normalizedUsername)) return { error: { message: "invalid_username" } };
  if (!password || password.length < MIN_PASSWORD_LENGTH) return { error: { message: "weak_password" } };

  const { data, error } = await supabase.auth.signUp({
    email: usernameToAuthEmail(normalizedUsername),
    password,
    options: { data: { username: normalizedUsername, display_name: name } },
  });
  if (error) {
  console.error("[signup] Supabase error:", {
    message: error.message,
    status: error.status,
    code: error.code,
  });

  const msg = error.message || "";
  if (/registered|already|duplicate/i.test(msg)) {
    return { error: { message: "duplicate_username" } };
  }
  if (/password/i.test(msg)) {
    return { error: { message: "weak_password" } };
  }
  return { error: { message: `signup_error: ${msg}` } };
}
  const user = data.user;
  if (!user) return { error: { message: "signup_no_user" } };
  // With "Confirm email" ON, Supabase answers an already-registered address
  // with an empty identities list instead of an error.
  if (Array.isArray(user.identities) && user.identities.length === 0) {
    return { error: { message: "duplicate_username" } };
  }
  // No session = "Confirm email" is still ON in Supabase. It can never be
  // satisfied for a synthetic address, so surface it clearly.
  if (!data.session) return { error: { message: "email_confirmation_required" } };

  const profile = await ensureProfile(user, { username: normalizedUsername, name });
  if (profile.error) return { error: profile.error };

  return { user, session: data.session };
}

export async function signInWithUsername(username, password) {
  const authEmail = usernameToAuthEmail(username);
  const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
  if (error) return { error: { message: "invalid_credentials" } };
  // Repairs an account whose profile row is missing (best effort).
  try {
    await ensureProfile(data.user);
  } catch (e) {
    // login itself succeeded
  }
  return { user: data.user, session: data.session };
}

export async function signOut() {
  await supabase.auth.signOut();
}

/* Self-service password change while signed in — no email required. */
export async function changePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error };
}

export async function getCurrentAuthUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getCurrentProfile() {
  const user = await getCurrentAuthUser();
  if (!user) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error) return null;
  return data;
}
