import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Coins,
  Handshake,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trophy,
  X,
} from "lucide-react";
import { repository } from "../data";
import type { Assignment, MatchOutcome } from "../types";
import { createIntentKeyTracker } from "../lib/idempotency";
const outcomes: Record<MatchOutcome, string> = {
  team_a_win: "فوز الفريق الأول",
  draw: "تعادل",
  team_b_win: "فوز الفريق التاني",
};

function GameResult({ slot }: { slot: Assignment }) {
  const [value, setValue] = useState<MatchOutcome | null>(null);
  const [review, setReview] = useState(false);
  const intent = useRef(createIntentKeyTracker());
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      repository.submitResult(
        slot.id,
        value!,
        intent.current.get(`${slot.id}|${value}`),
      ),
    onSuccess: async () => {
      intent.current.clear();
      await qc.invalidateQueries({ queryKey: ["assignments"] });
    },
  });
  const effect =
    value === "team_a_win"
      ? `${slot.teamAName} +${slot.winnerScore}، ${slot.teamBName} +${slot.loserScore}`
      : value === "team_b_win"
        ? `${slot.teamBName} +${slot.winnerScore}، ${slot.teamAName} +${slot.loserScore}`
        : `${slot.teamAName} و${slot.teamBName}، كل فريق +${slot.drawScore}`;
  return (
    <div className="result-form">
      <p className="form-prompt">اختار النتيجة</p>
      <div className="outcome-grid">
        <button
          type="button"
          className={value === "team_a_win" ? "selected win" : ""}
          onClick={() => {
            setValue("team_a_win");
            setReview(false);
          }}
        >
          <Trophy />
          <span>{slot.teamAName}</span>
          <small>+{slot.winnerScore}</small>
        </button>
        <button
          type="button"
          className={value === "draw" ? "selected draw" : ""}
          onClick={() => {
            setValue("draw");
            setReview(false);
          }}
        >
          <Handshake />
          <span>تعادل</span>
          <small>+{slot.drawScore} لكل فريق</small>
        </button>
        <button
          type="button"
          className={value === "team_b_win" ? "selected win" : ""}
          onClick={() => {
            setValue("team_b_win");
            setReview(false);
          }}
        >
          <Trophy />
          <span>{slot.teamBName}</span>
          <small>+{slot.winnerScore}</small>
        </button>
      </div>
      {review && value && (
        <div className="confirmation-panel">
          <strong>راجع النتيجة قبل القفل</strong>
          <p>{outcomes[value]}</p>
          <p>{effect} Kaizen</p>
          <div className="action-row">
            <button
              className="primary-button"
              disabled={m.isPending}
              onClick={() => m.mutate()}
            >
              {m.isPending ? <LoaderCircle className="spin" /> : <Check />}تأكيد
              وتسجيل
            </button>
            <button
              className="secondary-button"
              onClick={() => setReview(false)}
            >
              تعديل
            </button>
          </div>
        </div>
      )}
      {m.error && (
        <div className="inline-alert error">
          <AlertTriangle />
          {m.error.message}
        </div>
      )}
      {!review && (
        <button
          className="primary-button wide"
          disabled={!value}
          onClick={() => setReview(true)}
        >
          مراجعة النتيجة
        </button>
      )}
    </div>
  );
}

function TournamentResult({ slot }: { slot: Assignment }) {
  const ids = slot.participants.map((p) => p.teamId);
  const [rank, setRank] = useState({
    first: ids[0] ?? "",
    second: ids[1] ?? "",
    third: ids[2] ?? "",
  });
  const [review, setReview] = useState(false);
  const intent = useRef(createIntentKeyTracker());
  const qc = useQueryClient();
  const unique = new Set(Object.values(rank)).size === 3;
  const name = (id: string) =>
    slot.participants.find((p) => p.teamId === id)?.teamName;
  const others = slot.participants.filter(
    (p) => !Object.values(rank).includes(p.teamId),
  );
  const m = useMutation({
    mutationFn: () =>
      repository.submitTournamentResult({
        slotId: slot.id,
        firstTeamId: rank.first,
        secondTeamId: rank.second,
        thirdTeamId: rank.third,
        key: intent.current.get(
          `${slot.id}|${rank.first}|${rank.second}|${rank.third}`,
        ),
      }),
    onSuccess: async () => {
      intent.current.clear();
      await qc.invalidateQueries({ queryKey: ["assignments"] });
    },
  });
  const selector = (label: string, key: keyof typeof rank, score: number) => (
    <label>
      {label}، +{score} Kaizen
      <select
        value={rank[key]}
        onChange={(e) => {
          setReview(false);
          setRank({ ...rank, [key]: e.target.value });
        }}
      >
        {slot.participants.map((p) => (
          <option key={p.teamId} value={p.teamId}>
            {p.teamName}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="result-form tournament-result">
      <p className="form-prompt">
        رتّب أول 3، باقي الفرق هتاخد نفس النتيجة تلقائي
      </p>
      {selector("المركز الأول", "first", slot.firstScore)}
      {selector("المركز التاني", "second", slot.secondScore)}
      {selector("المركز التالت", "third", slot.thirdScore)}
      {!unique && (
        <div className="inline-alert error">
          <AlertTriangle />
          اختار 3 فرق مختلفين.
        </div>
      )}
      {review && unique && (
        <div className="confirmation-panel">
          <strong>راجع ترتيب الـTournament</strong>
          <p>
            ١. {name(rank.first)} +{slot.firstScore}
          </p>
          <p>
            ٢. {name(rank.second)} +{slot.secondScore}
          </p>
          <p>
            ٣. {name(rank.third)} +{slot.thirdScore}
          </p>
          <p>
            الباقي ({others.map((x) => x.teamName).join("، ")}): +
            {slot.othersScore} لكل فريق
          </p>
          <div className="action-row">
            <button
              className="primary-button"
              disabled={m.isPending}
              onClick={() => m.mutate()}
            >
              <Check />
              تأكيد وتسجيل
            </button>
            <button
              className="secondary-button"
              onClick={() => setReview(false)}
            >
              تعديل
            </button>
          </div>
        </div>
      )}
      {!review && (
        <button
          className="primary-button"
          disabled={!unique}
          onClick={() => setReview(true)}
        >
          مراجعة الترتيب
        </button>
      )}
    </div>
  );
}

function Bonus({ slot }: { slot: Assignment }) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(false);
  const [teamId, setTeamId] = useState(slot.participants[0]?.teamId ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const qc = useQueryClient();
  const intent = useRef(createIntentKeyTracker());
  const team = slot.participants.find((p) => p.teamId === teamId);
  const m = useMutation({
    mutationFn: () =>
      repository.awardBonus({
        slotId: slot.id,
        teamId,
        amount: Number(amount),
        reason,
        key: intent.current.get(`${slot.id}|${teamId}|${amount}|${reason}`),
      }),
    onSuccess: async () => {
      intent.current.clear();
      setOpen(false);
      setReview(false);
      setAmount("");
      setReason("");
      await qc.invalidateQueries({ queryKey: ["assignments"] });
    },
  });
  if (!open)
    return (
      <button
        className="bonus-trigger"
        disabled={slot.bonusRemaining <= 0}
        onClick={() => setOpen(true)}
      >
        <Coins />
        Bonus، متاح {slot.bonusRemaining} من {slot.bonusLimit}
      </button>
    );
  return (
    <div className="bonus-form">
      <div className="form-header">
        <div>
          <h3>Bonus الـSlot</h3>
          <p>متاح قبل تسجيل النتيجة فقط</p>
        </div>
        <button className="icon-button" onClick={() => setOpen(false)}>
          <X />
        </button>
      </div>
      <label>
        الفريق
        <select
          value={teamId}
          onChange={(e) => {
            setReview(false);
            setTeamId(e.target.value);
          }}
        >
          {slot.participants.map((p) => (
            <option key={p.teamId} value={p.teamId}>
              {p.teamName}
            </option>
          ))}
        </select>
      </label>
      <label>
        القيمة، المتاح {slot.bonusRemaining}
        <input
          type="number"
          min="1"
          max={slot.bonusRemaining}
          value={amount}
          onChange={(e) => {
            setReview(false);
            setAmount(e.target.value);
          }}
        />
      </label>
      <label>
        السبب
        <textarea
          required
          value={reason}
          onChange={(e) => {
            setReview(false);
            setReason(e.target.value);
          }}
        />
      </label>
      {review && (
        <div className="confirmation-panel">
          <strong>تأكيد الـBonus</strong>
          <p>
            {team?.teamName} هياخد +{amount} Kaizen
          </p>
          <p>
            المتبقي في الـSlot: {slot.bonusRemaining - Number(amount)} من{" "}
            {slot.bonusLimit}
          </p>
          <p>{reason}</p>
          <button
            className="primary-button"
            onClick={() => m.mutate()}
            disabled={m.isPending}
          >
            <Check />
            تأكيد الإضافة
          </button>
        </div>
      )}
      {!review && (
        <button
          className="primary-button"
          disabled={
            !reason ||
            Number(amount) < 1 ||
            Number(amount) > slot.bonusRemaining
          }
          onClick={() => setReview(true)}
        >
          مراجعة الـBonus
        </button>
      )}
    </div>
  );
}

export function ScorerPage() {
  const q = useQuery({
    queryKey: ["assignments"],
    queryFn: () => repository.getAssignments(),
  });
  const activeId = useMemo(
    () => q.data?.find((s) => !s.outcome && !s.tournamentResult)?.id,
    [q.data],
  );
  return (
    <main className="page scorer-page">
      <header className="page-heading">
        <p className="eyebrow">مهامك بس</p>
        <h1>جدول التسجيل</h1>
        <p className="muted">
          مفيش تحديث لحظي، اعمل تحديث بعد أي تعديل من المسؤول.
        </p>
      </header>
      <button
        className="refresh-button"
        disabled={q.isFetching}
        onClick={() => q.refetch()}
      >
        <RefreshCw className={q.isFetching ? "spin" : ""} />
        تحديث الجدول
      </button>
      {q.isLoading && (
        <div className="skeleton-list">
          <i />
          <i />
          <i />
        </div>
      )}
      {q.isError && (
        <div className="inline-alert error">
          <AlertTriangle />
          معرفناش نجيب مهامك.
        </div>
      )}
      {q.data?.length === 0 && (
        <section className="empty-state">
          <ShieldCheck />
          <h2>مفيش Slots متسندة لك</h2>
          <p>لما المسؤول يسند لك Slot هتظهر هنا.</p>
        </section>
      )}
      <ol className="timeline">
        {q.data?.map((slot) => {
          const done = !!slot.outcome || !!slot.tournamentResult;
          const active = slot.id === activeId;
          return (
            <li
              key={slot.id}
              className={`slot ${active ? "slot--active" : ""} ${done ? "slot--done" : ""}`}
            >
              <div className="timeline-mark">
                {done ? <Check /> : <Trophy />}
              </div>
              <article>
                <div className="slot-meta">
                  <span>
                    {slot.slotType === "game" ? "Game" : "Tournament"}
                  </span>
                </div>
                <h2>{slot.labelAr}</h2>
                {slot.slotType === "game" ? (
                  <div className="versus">
                    <strong>{slot.teamAName}</strong>
                    <b>ضد</b>
                    <strong>{slot.teamBName}</strong>
                  </div>
                ) : (
                  <p className="participant-line">
                    {slot.participants.map((p) => p.teamName).join("، ")}
                  </p>
                )}
                {done ? (
                  <div className="done-label">
                    <Check />
                    تم تسجيل النتيجة وقفلها
                  </div>
                ) : active ? (
                  <>
                    {slot.slotType === "game" ? (
                      <GameResult slot={slot} />
                    ) : (
                      <TournamentResult slot={slot} />
                    )}
                    <Bonus slot={slot} />
                  </>
                ) : (
                  <p className="upcoming">
                    الـSlot ده هيفتح بعد تسجيل اللي قبله
                  </p>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
