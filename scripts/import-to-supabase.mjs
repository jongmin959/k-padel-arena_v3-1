/*
 * OPTIONAL — run this only after scripts/export-from-upstash.mjs
 * produced a legacy-export.json with real data in it.
 *
 * SECURITY: this uses the Supabase SERVICE ROLE key, which bypasses
 * Row Level Security entirely. Run it locally, on your own machine,
 * and never commit the key or paste it into the app's .env files —
 * it is NOT one of the NEXT_PUBLIC_ variables.
 *
 * What this does:
 *   - Creates a real Supabase Auth user for each legacy player, using
 *     the same username -> synthetic-email scheme as the live app
 *     (see lib/auth.js), with a RANDOM temporary password.
 *   - IMPORTANT: your old members' real passwords were only ever
 *     stored as a one-way hash, by design — there was never a way to
 *     recover the original password, so it genuinely cannot be
 *     carried over. Every migrated member is flagged
 *     needs_password_reset = true and must set a new password
 *     (via an admin-assisted reset, since self-service email reset
 *     isn't wired up yet — see MIGRATION_GUIDE.md).
 *   - Creates one club with the legacy venue/format/courts/amenities,
 *     with the FIRST legacy player as owner (change OWNER_USERNAME
 *     below if you want someone else to own it).
 *   - Re-creates matches and bookings, preserving scores and dates.
 *
 * This script only INSERTs. It never deletes or touches anything
 * that already exists in your Supabase project.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/import-to-supabase.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTH_EMAIL_DOMAIN = "padelconnect.invalid";

// Change this if you want a different legacy player to own the club.
const OWNER_USERNAME = null; // null = use the first player found

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function randomPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

async function ensureAuthUser(displayName, fallbackUsername) {
  const username = (fallbackUsername || displayName).toLowerCase().replace(/[^a-z0-9_]/g, "") || `member${Date.now()}`;
  const email = `${username}@${AUTH_EMAIL_DOMAIN}`;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: randomPassword(),
    email_confirm: true,
  });
  if (error) {
    console.warn(`  ! could not create auth user for ${username}:`, error.message);
    return null;
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: data.user.id,
    username,
    display_name: displayName,
    level: 3.0,
    needs_password_reset: true,
  });
  if (profileError) {
    console.warn(`  ! could not insert profile for ${username}:`, profileError.message);
    return null;
  }

  return { id: data.user.id, username };
}

async function main() {
  const raw = await readFile("legacy-export.json", "utf-8");
  const { league, venuePhotos } = JSON.parse(raw);

  console.log(`Importing legacy club "${league.name}" with ${league.players?.length || 0} players...`);

  const idMap = {}; // legacy player id -> new profile id
  let ownerId = null;

  for (const legacyPlayer of league.players || []) {
    const created = await ensureAuthUser(legacyPlayer.name, legacyPlayer.id === OWNER_USERNAME ? OWNER_USERNAME : null);
    if (created) {
      idMap[legacyPlayer.id] = created.id;
      if (!ownerId) ownerId = created.id; // first successfully-created player owns the club
      console.log(`  created ${created.username} (needs password reset)`);
    }
  }

  if (!ownerId) {
    console.error("No players could be migrated — aborting club creation.");
    return;
  }

  const { data: club, error: clubError } = await supabase
    .from("clubs")
    .insert({
      name: league.name,
      venue: league.venue,
      format: league.format,
      court_count: league.courtCount,
      amenities: league.amenities || {},
      photo_url: venuePhotos?.[league.venue] || null,
      result_photo_url: league.resultPhoto || null,
      owner_id: ownerId,
    })
    .select()
    .single();
  if (clubError) {
    console.error("Could not create club:", clubError.message);
    return;
  }
  console.log(`Created club ${club.id}`);

  const memberRows = Object.values(idMap).map((profileId) => ({
    club_id: club.id,
    profile_id: profileId,
    role: profileId === ownerId ? "owner" : "player",
  }));
  await supabase.from("club_members").insert(memberRows);

  const matchRows = [];
  for (const round of league.rounds || []) {
    for (const m of round.matches) {
      const sideA = m.sideA.map((pid) => idMap[pid]).filter(Boolean);
      const sideB = m.sideB.map((pid) => idMap[pid]).filter(Boolean);
      if (sideA.length !== m.sideA.length || sideB.length !== m.sideB.length) {
        console.warn(`  ! skipping round ${round.roundNumber} match (unmapped player id — likely round-robin team id)`);
        continue;
      }
      matchRows.push({
        club_id: club.id,
        round_number: round.roundNumber,
        court_number: m.court,
        side_a_ids: sideA,
        side_b_ids: sideB,
        score_a: m.scoreA === "" ? null : Number(m.scoreA),
        score_b: m.scoreB === "" ? null : Number(m.scoreB),
        sit_out_ids: (round.sitOut || []).map((pid) => idMap[pid]).filter(Boolean),
      });
    }
  }
  if (matchRows.length) {
    await supabase.from("matches").insert(matchRows);
    console.log(`Imported ${matchRows.length} matches.`);
  }

  for (const booking of league.bookings || []) {
    const { data: bookingRow, error: bErr } = await supabase
      .from("bookings")
      .insert({
        club_id: club.id,
        court_number: booking.court,
        booking_date: booking.date,
        booking_time: booking.time,
        category: booking.category,
        group_id: booking.groupId || crypto.randomUUID(),
      })
      .select()
      .single();
    if (bErr) {
      console.warn("  ! skipping a booking:", bErr.message);
      continue;
    }
    const participantRows = (booking.players || []).map((p) => ({
      booking_id: bookingRow.id,
      profile_id: idMap[p.id] || null,
      guest_name: idMap[p.id] ? null : p.name,
    }));
    if (participantRows.length) await supabase.from("booking_participants").insert(participantRows);
  }
  console.log(`Imported ${(league.bookings || []).length} booking slots.`);

  console.log("\nDone. Every migrated member needs their password reset before they can log in —");
  console.log("see MIGRATION_GUIDE.md for the admin-assisted reset steps.");
}

main();
