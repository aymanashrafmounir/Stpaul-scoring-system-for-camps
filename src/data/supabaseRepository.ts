import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type {
  AdminDashboard,
  Assignment,
  CampRepository,
  LedgerEntry,
  MatchOutcome,
  WalletView,
} from "../types";

type Row = Record<string, unknown>;
const localizedDatabaseErrors: Record<string, string> = {
  "22023": "البيانات المدخلة غير صحيحة أو العملية اتغيرت أثناء إعادة المحاولة.",
  "23505": "العملية دي اتسجلت قبل كده.",
  "23514": "القيمة تتخطى الحد المسموح أو الرصيد المتاح.",
  "42501": "الحساب ده مش مسموح له ينفذ العملية.",
  "55000": "العملية اتقفلت ومينفعش تتعدل بعد تسجيل النتيجة أو انتهاء الكامب.",
  P0002: "البيانات المطلوبة مش موجودة.",
};
const client = () => {
  if (!supabase) throw new Error("إعدادات Supabase غير متاحة");
  return supabase;
};
const fail = (error: PostgrestError | Error | null) => {
  if (!error) return;
  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  throw new Error(
    localizedDatabaseErrors[code] ??
      "حصلت مشكلة في الاتصال. راجع البيانات وحاول تاني.",
  );
};
const text = (value: unknown) => String(value ?? "");
const number = (value: unknown) => Number(value ?? 0);

export const supabaseRepository: CampRepository = {
  mode: "supabase",
  async getAuth() {
    const {
      data: { session },
    } = await client().auth.getSession();
    if (!session) return null;
    const { data, error } = await client()
      .from("profiles")
      .select("user_id,username,display_name,role,is_active")
      .eq("user_id", session.user.id)
      .single();
    fail(error);
    const row = data as Row;
    return {
      userId: session.user.id,
      profile: {
        userId: text(row.user_id),
        displayName: text(row.display_name),
        username: text(row.username) || undefined,
        role: row.role as "admin" | "scorer",
        isActive: Boolean(row.is_active),
      },
    };
  },
  async signIn(identity, password) {
    const normalizedIdentity = identity.trim().toLowerCase();
    const email = normalizedIdentity.includes("@")
      ? normalizedIdentity
      : `${normalizedIdentity}@stpaul.local`;
    const { error } = await client().auth.signInWithPassword({
      email,
      password,
    });
    fail(error);
  },
  async signOut() {
    const { error } = await client().auth.signOut();
    fail(error);
  },
  async getAdminDashboard() {
    const [
      eventRes,
      teamsRes,
      profilesRes,
      slotsRes,
      resultsRes,
      tournamentResultsRes,
      ledgerRes,
      tokensRes,
      bonusesRes,
      participantRes,
    ] = await Promise.all([
      client().from("events").select("*").eq("is_active", true).single(),
      client().from("teams").select("*").order("name_ar"),
      client()
        .from("profiles")
        .select("*")
        .eq("role", "scorer")
        .order("display_name"),
      client().from("match_slots").select("*").order("scheduled_at"),
      client().from("match_results").select("slot_id,outcome"),
      client().from("tournament_results").select("slot_id"),
      client()
        .from("wallet_ledger")
        .select("*")
        .order("created_at", { ascending: false }),
      client()
        .from("nfc_tokens")
        .select("*")
        .order("issued_at", { ascending: false }),
      client().from("bonus_awards").select("slot_id,amount"),
      client().from("slot_participants").select("*"),
    ]);
    [
      eventRes,
      teamsRes,
      profilesRes,
      slotsRes,
      resultsRes,
      tournamentResultsRes,
      ledgerRes,
      tokensRes,
      bonusesRes,
      participantRes,
    ].forEach((response) => fail(response.error));
    const e = eventRes.data as Row;
    const teamRows = ((teamsRes.data ?? []) as Row[]).filter(
      (row) => row.event_id === e.id,
    );
    const slotRows = ((slotsRes.data ?? []) as Row[]).filter(
      (row) => row.event_id === e.id,
    );
    const profileRows = (profilesRes.data ?? []) as Row[];
    const resultRows = (resultsRes.data ?? []) as Row[];
    const tournamentResultRows = (tournamentResultsRes.data ?? []) as Row[];
    const activeTeamIds = new Set(teamRows.map((row) => text(row.id)));
    const ledgerRows = ((ledgerRes.data ?? []) as Row[]).filter((row) =>
      activeTeamIds.has(text(row.team_id)),
    );
    const bonusRows = (bonusesRes.data ?? []) as Row[];
    const teams = teamRows.map((row) => ({
      id: text(row.id),
      eventId: text(row.event_id),
      code: text(row.code),
      nameAr: text(row.name_ar),
    }));
    const names = new Map(teams.map((team) => [team.id, team.nameAr]));
    const profileNames = new Map(
      profileRows.map((row) => [text(row.user_id), text(row.display_name)]),
    );
    const results = new Map(
      resultRows.map((row) => [text(row.slot_id), row.outcome as MatchOutcome]),
    );
    const submittedTournaments = new Set(tournamentResultRows.map((row) => text(row.slot_id)));
    const scorers = profileRows.map((row) => ({
      userId: text(row.user_id),
      displayName: text(row.display_name),
      username: text(row.username) || undefined,
      role: "scorer" as const,
      isActive: Boolean(row.is_active),
    }));
    const usedBySlot = new Map<string, number>();
    bonusRows.forEach((row) =>
      usedBySlot.set(
        text(row.slot_id),
        (usedBySlot.get(text(row.slot_id)) ?? 0) + number(row.amount),
      ),
    );
    const participantRows = (participantRes.data ?? []) as Row[];
    const slots = slotRows.map((row) => {
      const participantIds = participantRows
        .filter((p) => p.slot_id === row.id)
        .map((p) => text(p.team_id));
      const slotType = (text(row.slot_type) || "game") as "game" | "tournament";
      const gameTeamIds = [text(row.team_a_id), text(row.team_b_id)].filter(Boolean);
      const ids = slotType === "game" ? gameTeamIds : participantIds;
      return {
        id: text(row.id),
        eventId: text(row.event_id),
        slotNumber: number(row.slot_number),
        labelAr: text(row.label_ar),
        scheduledAt: text(row.scheduled_at),
        scorerId: text(row.scorer_id),
        scorerName: profileNames.get(text(row.scorer_id)),
        slotType,
        teamAId: ids[0],
        teamAName: names.get(ids[0]) ?? "",
        teamBId: ids[1],
        teamBName: names.get(ids[1]) ?? "",
        participants: ids.map((teamId) => ({
          teamId,
          teamName: names.get(teamId) ?? "",
        })),
        winnerScore: number(row.winner_score ?? 50),
        drawScore: number(row.draw_score ?? 25),
        loserScore: number(row.loser_score ?? 20),
        firstScore: number(row.first_score ?? 175),
        secondScore: number(row.second_score ?? 125),
        thirdScore: number(row.third_score ?? 75),
        othersScore: number(row.others_score ?? 30),
        bonusLimit: number(row.bonus_limit ?? 10),
        bonusUsed: usedBySlot.get(text(row.id)) ?? 0,
        outcome: results.get(text(row.id)) ?? null,
        isSubmitted: results.has(text(row.id)) || submittedTournaments.has(text(row.id)),
      };
    });
    const ledger: LedgerEntry[] = ledgerRows.map((row) => ({
      id: text(row.id),
      teamId: text(row.team_id),
      teamName: names.get(text(row.team_id)),
      amount: number(row.amount),
      kind: row.kind as LedgerEntry["kind"],
      descriptionAr: text(row.description_ar),
      createdAt: text(row.created_at),
    }));
    const balances: Record<string, number> = {};
    teams.forEach((team) => {
      balances[team.id] = 0;
    });
    ledgerRows.forEach((row) => {
      balances[text(row.team_id)] =
        (balances[text(row.team_id)] ?? 0) + number(row.amount);
    });
    return {
      event: {
        id: text(e.id),
        name: text(e.name),
        startsAt: text(e.starts_at),
        endsAt: text(e.ends_at),
        winnerCoins: number(e.winner_coins),
        drawCoins: number(e.draw_coins),
        loserCoins: number(e.loser_coins),
        isActive: Boolean(e.is_active),
      },
      teams,
      scorers,
      slots,
      ledger,
      nfcTokens: ((tokensRes.data ?? []) as Row[])
        .filter((row) => activeTeamIds.has(text(row.team_id)))
        .map((row) => ({
          id: text(row.id),
          teamId: text(row.team_id),
          label: text(row.label),
          issuedAt: text(row.issued_at),
          revokedAt: row.revoked_at ? text(row.revoked_at) : null,
          lastUsedAt: row.last_used_at ? text(row.last_used_at) : null,
        })),
      balances,
    } satisfies AdminDashboard;
  },
  async saveTeam(input) {
    const payload = {
      event_id: input.eventId,
      // The database still needs a technical unique code; it is not an admin input.
      code: input.id ? undefined : `TEAM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      name_ar: input.nameAr.trim(),
      ...(input.id ? { id: input.id } : {}),
    };
    const { error } = await client().from("teams").upsert(payload);
    fail(error);
  },
  async deleteTeam(teamId) {
    const { error } = await client().rpc("delete_team", { p_team_id: teamId });
    fail(error);
  },
  async saveScorer(input) {
    if (!input.userId) {
      const { error } = await client().functions.invoke("create-scorer", {
        body: {
          username: input.username?.trim().toLowerCase(),
          password: input.initialPassword,
          display_name: input.displayName.trim(),
          event_id: input.eventId,
          bonus_limit: 0,
        },
      });
      fail(error);
      return;
    }
    const { error } = await client().rpc("update_scorer_settings", {
      p_scorer_id: input.userId,
      p_event_id: input.eventId,
      p_display_name: input.displayName.trim(),
      p_is_active: input.isActive,
      p_bonus_limit: 0,
    });
    fail(error);
    if (input.newPassword) {
      const { error: passwordError } = await client().functions.invoke(
        "reset-scorer-password",
        {
          body: { scorer_id: input.userId, new_password: input.newPassword },
        },
      );
      fail(passwordError);
    }
  },
  async saveSlot(input) {
    const { error } = await client().rpc("upsert_slot_v2", {
      p_request: {
        id: input.id,
        event_id: input.eventId,
        slot_number: input.slotNumber,
        label_ar: input.labelAr.trim(),
        scheduled_at: input.scheduledAt,
        scorer_id: input.scorerId,
        slot_type: input.slotType,
        team_ids: input.participantTeamIds,
        winner_score: input.winnerScore,
        draw_score: input.drawScore,
        loser_score: input.loserScore,
        first_score: input.firstScore,
        second_score: input.secondScore,
        third_score: input.thirdScore,
        others_score: input.othersScore,
        bonus_limit: input.bonusLimit,
      },
    });
    fail(error);
  },
  async deleteSlot(slotId) {
    const { error } = await client().rpc("delete_slot", { p_slot_id: slotId });
    fail(error);
  },
  async issueNfc(teamId) {
    const { data, error } = await client().rpc("issue_nfc_token", {
      p_team_id: teamId,
      p_label: "team",
    });
    fail(error);
    return text(data);
  },
  async revokeNfc(tokenId) {
    const { error } = await client().rpc("revoke_nfc_token", {
      p_token_id: tokenId,
    });
    fail(error);
  },
  async reassignNfc(tokenId, teamId) {
    const { data, error } = await client().rpc("reassign_nfc_token", {
      p_token_id: tokenId,
      p_team_id: teamId,
    });
    fail(error);
    return text(data);
  },
  async deleteNfc(tokenId) {
    const { error } = await client().rpc("delete_nfc_token", {
      p_token_id: tokenId,
    });
    fail(error);
  },
  async spendKaizen(teamId, amount, note, key) {
    const { error } = await client().rpc("redeem_by_team", {
      p_team_id: teamId,
      p_amount: amount,
      p_note: note.trim(),
      p_idempotency_key: key,
    });
    fail(error);
  },
  async adjustWallet(teamId, amount, reason, key) {
    const { error } = await client().rpc("adjust_wallet", {
      p_team_id: teamId,
      p_amount: amount,
      p_reason: reason.trim(),
      p_idempotency_key: key,
    });
    fail(error);
  },
  async reverseEntry(entryId, reason) {
    const { error } = await client().rpc("reverse_wallet_entry", {
      p_entry_id: entryId,
      p_reason: reason.trim(),
    });
    fail(error);
  },
  async getAssignments() {
    const { data, error } = await client().rpc("my_assignments");
    fail(error);
    return ((data ?? []) as Row[]).map((wrapper): Assignment => {
      const row = (wrapper.assignment ?? wrapper) as Row;
      const scores = (row.scores ?? {}) as Row;
      const participants = ((row.participants ?? []) as Row[]).map((p) => ({
        teamId: text(p.team_id),
        teamName: text(p.name_ar),
      }));
      const tournament = (row.tournament_result ?? null) as Row | null;
      return {
        id: text(row.slot_id),
        eventId: "",
        slotNumber: number(row.slot_number),
        labelAr: text(row.label_ar),
        scheduledAt: text(row.scheduled_at),
        scorerId: "",
        slotType: (text(row.slot_type) || "game") as "game" | "tournament",
        teamAId: participants[0]?.teamId,
        teamAName: participants[0]?.teamName,
        teamBId: participants[1]?.teamId,
        teamBName: participants[1]?.teamName,
        participants,
        winnerScore: number(scores.winner ?? 50),
        drawScore: number(scores.draw ?? 25),
        loserScore: number(scores.loser ?? 20),
        firstScore: number(scores.first ?? 175),
        secondScore: number(scores.second ?? 125),
        thirdScore: number(scores.third ?? 75),
        othersScore: number(scores.others ?? 30),
        outcome: (row.game_outcome as MatchOutcome | null) ?? null,
        bonusLimit: number(row.bonus_limit),
        bonusUsed: number(row.bonus_used),
        bonusRemaining: number(row.bonus_remaining),
        tournamentResult: tournament
          ? {
              firstTeamId: text(tournament.first_team_id),
              secondTeamId: text(tournament.second_team_id),
              thirdTeamId: text(tournament.third_team_id),
            }
          : null,
      };
    });
  },
  async submitResult(slotId, outcome, key) {
    const { error } = await client().rpc("submit_game_result", {
      p_slot_id: slotId,
      p_outcome: outcome,
      p_idempotency_key: key,
    });
    fail(error);
  },
  async submitTournamentResult(input) {
    const { error } = await client().rpc("submit_tournament_result", {
      p_slot_id: input.slotId,
      p_first_team_id: input.firstTeamId,
      p_second_team_id: input.secondTeamId,
      p_third_team_id: input.thirdTeamId,
      p_idempotency_key: input.key,
    });
    fail(error);
  },
  async awardBonus(input) {
    const { error } = await client().rpc("award_slot_bonus", {
      p_slot_id: input.slotId,
      p_team_id: input.teamId,
      p_amount: input.amount,
      p_reason: input.reason.trim(),
      p_idempotency_key: input.key,
    });
    fail(error);
  },
  async getWallet(token) {
    const { data, error } = await client().rpc("get_team_wallet_by_nfc", {
      p_token: token,
    });
    fail(error);
    const payload = data as Row;
    const team = payload.team as Row;
    return {
      team: { code: text(team.code), nameAr: text(team.name_ar) },
      balance: number(payload.balance),
      transactions: ((payload.transactions ?? []) as Row[]).map((row) => ({
        amount: number(row.amount),
        kind: row.kind as LedgerEntry["kind"],
        descriptionAr: text(row.description_ar),
        createdAt: text(row.created_at),
      })),
    } satisfies WalletView;
  },
};
