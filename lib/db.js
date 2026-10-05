import { supabase } from "./supabaseClient";

/* =====================================================================
   Image helpers — resize in the browser before upload so a phone photo
   doesn't become a multi-MB Storage object.
   ===================================================================== */
export function resizeImageToBlob(file, maxWidth = 1000, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("파일을 읽지 못했습니다"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas unavailable"));
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/jpeg", quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadToBucket(bucket, path, blob) {
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadAvatar(profileId, file) {
  const blob = await resizeImageToBlob(file, 500);
  const url = await uploadToBucket("avatars", `${profileId}/avatar-${Date.now()}.jpg`, blob);
  const { error } = await supabase.from("profiles").update({ photo_url: url }).eq("id", profileId);
  if (error) throw error;
  return url;
}

export async function setAvatarUrl(profileId, url) {
  const { error } = await supabase.from("profiles").update({ photo_url: url }).eq("id", profileId);
  if (error) throw error;
}

export async function updateProfileLevel(profileId, level) {
  const { error } = await supabase.from("profiles").update({ level }).eq("id", profileId);
  if (error) throw error;
}

export async function uploadClubPhoto(clubId, file) {
  const blob = await resizeImageToBlob(file, 1200);
  const url = await uploadToBucket("club-photos", `${clubId}/banner-${Date.now()}.jpg`, blob);
  const { error } = await supabase.from("clubs").update({ photo_url: url }).eq("id", clubId);
  if (error) throw error;
  return url;
}

export async function uploadResultPhoto(clubId, file) {
  const blob = await resizeImageToBlob(file, 1400);
  const url = await uploadToBucket("result-photos", `${clubId}/result-${Date.now()}.jpg`, blob);
  const { error } = await supabase.from("clubs").update({ result_photo_url: url }).eq("id", clubId);
  if (error) throw error;
  return url;
}

export async function setClubPhotoUrl(clubId, url) {
  const { error } = await supabase.from("clubs").update({ photo_url: url }).eq("id", clubId);
  if (error) throw error;
}

export async function setResultPhotoUrl(clubId, url) {
  const { error } = await supabase.from("clubs").update({ result_photo_url: url }).eq("id", clubId);
  if (error) throw error;
}

export async function uploadCourtPhoto(clubId, courtNumber, file) {
  const blob = await resizeImageToBlob(file, 900);
  const url = await uploadToBucket("court-photos", `${clubId}/court-${courtNumber}-${Date.now()}.jpg`, blob);
  const { error } = await supabase
    .from("courts")
    .upsert({ club_id: clubId, court_number: courtNumber, photo_url: url }, { onConflict: "club_id,court_number" });
  if (error) throw error;
  return url;
}

/* =====================================================================
   Club: load-or-create "my" club, and field updates.
   ===================================================================== */
export async function getMyClub(profileId) {
  const { data: membership, error: memErr } = await supabase
    .from("club_members")
    .select("club_id")
    .eq("profile_id", profileId)
    .limit(1)
    .maybeSingle();
  if (memErr) throw memErr;
  if (!membership) return null;

  const { data: club, error } = await supabase.from("clubs").select("*").eq("id", membership.club_id).single();
  if (error) throw error;
  return club;
}

export async function createClub(profileId, { venue }) {
  const { data: club, error } = await supabase
    .from("clubs")
    .insert({ name: "새 리그", venue, owner_id: profileId })
    .select()
    .single();
  if (error) throw error;

  const { error: memErr } = await supabase
    .from("club_members")
    .insert({ club_id: club.id, profile_id: profileId, role: "owner" });
  if (memErr) throw memErr;

  return club;
}

export async function updateClub(clubId, patch) {
  // camelCase app fields -> snake_case columns
  const row = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.venue !== undefined) row.venue = patch.venue;
  if (patch.format !== undefined) row.format = patch.format;
  if (patch.courtCount !== undefined) row.court_count = patch.courtCount;
  if (patch.amenities !== undefined) row.amenities = patch.amenities;
  const { error } = await supabase.from("clubs").update(row).eq("id", clubId);
  if (error) throw error;
}

/* =====================================================================
   Players (club_members + profiles) and self-service join/leave.
   ===================================================================== */
export async function getClubPlayers(clubId) {
  const { data, error } = await supabase
    .from("club_members")
    .select("profile_id, guest_name, role, profiles(id, display_name, level, photo_url)")
    .eq("club_id", clubId);
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.profile_id || row.id,
    name: row.profiles?.display_name || row.guest_name || "?",
    role: row.role,
    level: row.profiles?.level,
    photo: row.profiles?.photo_url,
    isGuest: !row.profile_id,
  }));
}

export async function addGuestPlayer(clubId, name) {
  const { data, error } = await supabase
    .from("club_members")
    .insert({ club_id: clubId, guest_name: name, role: "player" })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, name };
}

export async function removeClubMember(clubId, memberIdOrProfileId) {
  const { error } = await supabase
    .from("club_members")
    .delete()
    .eq("club_id", clubId)
    .or(`profile_id.eq.${memberIdOrProfileId},id.eq.${memberIdOrProfileId}`);
  if (error) throw error;
}

export async function joinClubAsPlayer(clubId, profileId) {
  const { error } = await supabase
    .from("club_members")
    .upsert({ club_id: clubId, profile_id: profileId, role: "player" }, { onConflict: "club_id,profile_id", ignoreDuplicates: true });
  if (error) throw error;
}

/* =====================================================================
   Matches (rounds). Rounds are grouped client-side from flat match rows.
   ===================================================================== */
export async function getRounds(clubId) {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("club_id", clubId)
    .order("round_number", { ascending: true })
    .order("court_number", { ascending: true });
  if (error) throw error;

  const byRound = new Map();
  for (const row of data || []) {
    if (!byRound.has(row.round_number)) {
      byRound.set(row.round_number, { roundNumber: row.round_number, matches: [], sitOut: row.sit_out_ids || [] });
    }
    byRound.get(row.round_number).matches.push({
      id: row.id,
      court: row.court_number,
      sideA: row.side_a_ids,
      sideB: row.side_b_ids,
      scoreA: row.score_a === null ? "" : String(row.score_a),
      scoreB: row.score_b === null ? "" : String(row.score_b),
    });
  }
  return Array.from(byRound.values());
}

/* Replaces the ENTIRE schedule — used by "대진표 생성/다시 생성"
   (Americano upfront, or round-robin). */
export async function replaceAllRounds(clubId, rounds) {
  const { error: delErr } = await supabase.from("matches").delete().eq("club_id", clubId);
  if (delErr) throw delErr;
  if (rounds.length === 0) return;

  const rows = rounds.flatMap((round) =>
    round.matches.map((m) => ({
      club_id: clubId,
      round_number: round.roundNumber,
      court_number: m.court,
      side_a_ids: m.sideA,
      side_b_ids: m.sideB,
      score_a: m.scoreA === "" ? null : Number(m.scoreA),
      score_b: m.scoreB === "" ? null : Number(m.scoreB),
      sit_out_ids: round.sitOut || [],
    }))
  );
  const { error } = await supabase.from("matches").insert(rows);
  if (error) throw error;
}

/* Appends ONE round — used by Mexicano's "다음 라운드 생성". */
export async function appendRound(clubId, round) {
  const rows = round.matches.map((m) => ({
    club_id: clubId,
    round_number: round.roundNumber,
    court_number: m.court,
    side_a_ids: m.sideA,
    side_b_ids: m.sideB,
    score_a: m.scoreA === "" ? null : Number(m.scoreA),
    score_b: m.scoreB === "" ? null : Number(m.scoreB),
    sit_out_ids: round.sitOut || [],
  }));
  const { error } = await supabase.from("matches").insert(rows);
  if (error) throw error;
}

/* Removes the highest-numbered round — used by Mexicano's "마지막 라운드 취소". */
export async function removeLastRound(clubId, roundNumber) {
  const { error } = await supabase.from("matches").delete().eq("club_id", clubId).eq("round_number", roundNumber);
  if (error) throw error;
}

/* Clears all matches for a club — used by "새 시즌으로 초기화". Never
   deletes the club, its members, or their profiles. */
export async function clearAllMatches(clubId) {
  const { error } = await supabase.from("matches").delete().eq("club_id", clubId);
  if (error) throw error;
}

export async function updateMatchScore(matchId, field, value) {
  const column = field === "scoreA" ? "score_a" : "score_b";
  const { error } = await supabase
    .from("matches")
    .update({ [column]: value === "" ? null : Number(value) })
    .eq("id", matchId);
  if (error) throw error;
}

/* =====================================================================
   Bookings — one row per hour; a multi-hour reservation shares group_id.
   ===================================================================== */
export async function getBookings(clubId) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*, booking_participants(id, profile_id, guest_name, profiles(display_name))")
    .eq("club_id", clubId);
  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    groupId: row.group_id,
    court: row.court_number,
    date: row.booking_date,
    time: row.booking_time?.slice(0, 5),
    category: row.category,
    players: (row.booking_participants || []).map((p) => ({
      id: p.profile_id || p.id,
      name: p.profiles?.display_name || p.guest_name || "게스트",
    })),
  }));
}

/* Creates a new multi-hour booking group with the first participant. */
export async function createBookingGroup(clubId, { court, date, times, category, participant }) {
  const groupId = crypto.randomUUID();
  const rows = times.map((time) => ({
    club_id: clubId,
    court_number: court,
    booking_date: date,
    booking_time: time,
    category,
    group_id: groupId,
  }));
  const { data: inserted, error } = await supabase.from("bookings").insert(rows).select();
  if (error) throw error;

  const participantRows = inserted.map((b) => ({
    booking_id: b.id,
    profile_id: participant.profileId || null,
    guest_name: participant.profileId ? null : participant.name,
  }));
  const { error: partErr } = await supabase.from("booking_participants").insert(participantRows);
  if (partErr) throw partErr;

  return groupId;
}

/* Adds a participant to every booking row sharing a group_id. */
export async function joinBookingGroup(clubId, groupId, participant) {
  const { data: bookingRows, error } = await supabase
    .from("bookings")
    .select("id")
    .eq("club_id", clubId)
    .eq("group_id", groupId);
  if (error) throw error;

  const participantRows = bookingRows.map((b) => ({
    booking_id: b.id,
    profile_id: participant.profileId || null,
    guest_name: participant.profileId ? null : participant.name,
  }));
  const { error: partErr } = await supabase.from("booking_participants").insert(participantRows);
  if (partErr) throw partErr;
}

/* Removes one participant (by their booking_participants row id) from
   every hour of their group — mirrors the old "remove from this slot"
   behavior, but across the whole multi-hour reservation. */
export async function removeBookingParticipant(clubId, groupId, participantMatch) {
  const { data: bookingRows, error } = await supabase
    .from("bookings")
    .select("id")
    .eq("club_id", clubId)
    .eq("group_id", groupId);
  if (error) throw error;
  const bookingIds = bookingRows.map((b) => b.id);
  if (bookingIds.length === 0) return;

  let query = supabase.from("booking_participants").delete().in("booking_id", bookingIds);
  query = participantMatch.profileId
    ? query.eq("profile_id", participantMatch.profileId)
    : query.eq("guest_name", participantMatch.name);
  const { error: delErr } = await query;
  if (delErr) throw delErr;
}

/* =====================================================================
   Realtime — live updates across everyone viewing the same club.
   ===================================================================== */
export function subscribeToClub(clubId, onChange) {
  const channel = supabase
    .channel(`club-${clubId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "clubs", filter: `id=eq.${clubId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `club_id=eq.${clubId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `club_id=eq.${clubId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "club_members", filter: `club_id=eq.${clubId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "courts", filter: `club_id=eq.${clubId}` }, onChange)
    .subscribe();

  return () => supabase.removeChannel(channel);
}
