export type Role = "admin" | "scorer";
export type MatchOutcome = "team_a_win" | "draw" | "team_b_win";
export type SlotType = "game" | "tournament";
export type LedgerKind =
  "match" | "bonus" | "redemption" | "reversal" | "adjustment";

export interface Profile {
  userId: string;
  displayName: string;
  username?: string;
  role: Role;
  isActive: boolean;
}

export interface EventConfig {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  winnerCoins: number;
  drawCoins: number;
  loserCoins: number;
  isActive: boolean;
}

export interface Team {
  id: string;
  eventId: string;
  code: string;
  nameAr: string;
}

export type Scorer = Profile;

export interface Slot {
  id: string;
  eventId: string;
  slotNumber: number;
  labelAr: string;
  scheduledAt: string;
  scorerId: string;
  scorerName?: string;
  slotType: SlotType;
  teamAId?: string;
  teamAName?: string;
  teamBId?: string;
  teamBName?: string;
  participants: Array<{ teamId: string; teamName: string }>;
  winnerScore: number;
  drawScore: number;
  loserScore: number;
  firstScore: number;
  secondScore: number;
  thirdScore: number;
  othersScore: number;
  bonusLimit: number;
  bonusUsed: number;
  outcome?: MatchOutcome | null;
  tournamentResult?: {
    firstTeamId: string;
    secondTeamId: string;
    thirdTeamId: string;
  } | null;
  isSubmitted?: boolean;
}

export interface Assignment extends Slot {
  bonusRemaining: number;
}

export interface BonusAward {
  id: string;
  slotId: string;
  teamId: string;
  teamName?: string;
  amount: number;
  reason: string;
  awardedAt: string;
}

export interface LedgerEntry {
  id: string;
  teamId: string;
  teamName?: string;
  amount: number;
  kind: LedgerKind;
  descriptionAr: string;
  createdAt: string;
}

export interface NfcTokenRecord {
  id: string;
  teamId: string;
  label: string;
  issuedAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface AdminDashboard {
  event: EventConfig;
  teams: Team[];
  scorers: Scorer[];
  slots: Slot[];
  bonuses: BonusAward[];
  ledger: LedgerEntry[];
  nfcTokens: NfcTokenRecord[];
  balances: Record<string, number>;
}

export interface WalletView {
  team: Pick<Team, "code" | "nameAr">;
  balance: number;
  transactions: Array<
    Pick<LedgerEntry, "amount" | "kind" | "descriptionAr" | "createdAt">
  >;
}

export interface AuthState {
  userId: string;
  profile: Profile;
}

export interface CampRepository {
  mode: "supabase";
  getAuth(): Promise<AuthState | null>;
  signIn(identity: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  getAdminDashboard(): Promise<AdminDashboard>;
  saveTeam(input: {
    id?: string;
    eventId: string;
    nameAr: string;
  }): Promise<void>;
  deleteTeam(teamId: string): Promise<void>;
  saveScorer(input: {
    userId?: string;
    displayName: string;
    username?: string;
    initialPassword?: string;
    newPassword?: string;
    isActive: boolean;
    eventId: string;
  }): Promise<void>;
  saveSlot(
    input: Omit<
      Slot,
      | "teamAName"
      | "teamBName"
      | "scorerName"
      | "outcome"
      | "bonusUsed"
      | "participants"
    > & { participantTeamIds: string[] },
  ): Promise<void>;
  deleteSlot(slotId: string): Promise<void>;
  issueNfc(teamId: string): Promise<string>;
  revokeNfc(tokenId: string): Promise<void>;
  reassignNfc(tokenId: string, teamId: string): Promise<string>;
  deleteNfc(tokenId: string): Promise<void>;
  spendKaizen(
    teamId: string,
    amount: number,
    note: string,
    key: string,
  ): Promise<void>;
  adjustWallet(
    teamId: string,
    amount: number,
    reason: string,
    key: string,
  ): Promise<void>;
  reverseEntry(entryId: string, reason: string): Promise<void>;
  correctSlotResult(input: {
    slotId: string;
    result:
      | { outcome: MatchOutcome }
      | {
          firstTeamId: string;
          secondTeamId: string;
          thirdTeamId: string;
        };
    reason: string;
    key: string;
  }): Promise<void>;
  undoBonus(input: {
    bonusId: string;
    reason: string;
    key: string;
  }): Promise<void>;
  getAssignments(): Promise<Assignment[]>;
  submitResult(
    slotId: string,
    outcome: MatchOutcome,
    key: string,
  ): Promise<void>;
  submitTournamentResult(input: {
    slotId: string;
    firstTeamId: string;
    secondTeamId: string;
    thirdTeamId: string;
    key: string;
  }): Promise<void>;
  awardBonus(input: {
    slotId: string;
    teamId: string;
    amount: number;
    reason: string;
    key: string;
  }): Promise<void>;
  getWallet(token: string): Promise<WalletView>;
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}
