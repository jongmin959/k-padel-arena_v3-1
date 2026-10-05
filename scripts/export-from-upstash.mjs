/*
 * OPTIONAL — only run this if you previously deployed the earlier
 * Vercel + Upstash Redis version of this app and have real data there
 * (members, a club, bookings). If you only ever used the chat-artifact
 * preview, there is nothing to export: that version stored data
 * privately per browser, so there was never a single shared copy to
 * migrate (see the analysis from earlier in this project).
 *
 * This script does NOT delete or modify anything in Upstash — it only
 * reads and writes a local JSON file.
 *
 * Usage:
 *   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
 *     node scripts/export-from-upstash.mjs
 *
 * Produces: legacy-export.json
 */

const URL_ = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!URL_ || !TOKEN) {
  console.error("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN first.");
  process.exit(1);
}

async function get(key) {
  const res = await fetch(`${URL_}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function main() {
  const legacyLeague = await get("padel-league-active-v1");
  if (!legacyLeague) {
    console.log("No data found at key 'padel-league-active-v1'. Nothing to export.");
    return;
  }

  const venues = ["Yongsan Mmove", "Gimpo Padel Society", "Dongtan Garros Padel"];
  const venuePhotos = {};
  for (const v of venues) {
    const photo = await get(`padel-venue-photo:${v}`);
    if (photo) venuePhotos[v] = photo;
  }

  const fs = await import("node:fs/promises");
  await fs.writeFile(
    "legacy-export.json",
    JSON.stringify({ league: legacyLeague, venuePhotos }, null, 2)
  );
  console.log("Wrote legacy-export.json —", legacyLeague.players?.length || 0, "players,", legacyLeague.bookings?.length || 0, "bookings found.");
  console.log("Next: review the file, then run scripts/import-to-supabase.mjs");
}

main();
