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

export async function signUpWithUsername({
  username,
  password,
  name,
  phone,
  email,
  gender,
  region,
  level,
  photoUrl,
}) {
  const normalizedUsername = username.trim().toLowerCase();

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", normalizedUsername)
    .maybeSingle();
  if (existing) {
    return { error: { message: "duplicate_username" } };
  }

  const authEmail = usernameToAuthEmail(normalizedUsername);
  const { data, error } = await supabase.auth.signUp({ email: authEmail, password });
  if (error) return { error };
  const user = data.user;
  if (!user) return { error: { message: "signup_no_user" } };

  const { error: profileError } = await supabase.from("profiles").insert({
    id: user.id,
    username: normalizedUsername,
    display_name: name,
    phone: phone || null,
    email: email || null,
    gender: gender || null,
    region: region || null,
    level,
    photo_url: photoUrl || null,
  });
  if (profileError) return { error: profileError };

  return { user, session: data.session };
}

export async function signInWithUsername(username, password) {
  const authEmail = usernameToAuthEmail(username);
  const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
  if (error) return { error: { message: "invalid_credentials" } };
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
