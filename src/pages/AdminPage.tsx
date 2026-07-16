import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Coins,
  Copy,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  SmartphoneNfc,
  Trophy,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { repository } from "../data";
import type { AdminDashboard, Slot, SlotType } from "../types";
import { createIntentKeyTracker } from "../lib/idempotency";
import { canReadNfc, readNfcCapability } from "../lib/nfcReader";
import { canWriteNfc, getNfcWriteAvailability, writeUrlToNfc } from "../lib/nfcWriter";

type Tab = "overview" | "teams" | "scorers" | "slots" | "spend" | "cards";
const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "الملخص" },
  { id: "teams", label: "الفرق" },
  { id: "scorers", label: "Scorers" },
  { id: "slots", label: "Slots" },
  { id: "spend", label: "إدارة Kaizen" },
  { id: "cards", label: "الكروت" },
];
const feedback = (m: { error: Error | null; isSuccess: boolean }) => (
  <>
    {m.error && (
      <div className="inline-alert error">
        <AlertTriangle />
        {m.error.message}
      </div>
    )}
    {m.isSuccess && (
      <div className="inline-alert success">
        <Check />
        تم الحفظ.
      </div>
    )}
  </>
);

function generatePassword(): string {
  const required = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "#?!@$%"];
  const alphabet = required.join("");
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const characters = required.map((group, index) => group[bytes[index] % group.length]);
  for (let index = required.length; index < bytes.length; index += 1) {
    characters.push(alphabet[bytes[index] % alphabet.length]);
  }
  const shuffleBytes = crypto.getRandomValues(new Uint8Array(characters.length));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = shuffleBytes[index] % (index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

function CredentialReceipt({ username, password, onDismiss }: { username: string; password: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return <div className="credential-receipt" role="status">
    <KeyRound />
    <div><strong>بيانات الدخول الجديدة</strong><span dir="ltr">{username} / {password}</span><small>انسخها دلوقتي، كلمة السر مش هتظهر تاني بعد ما تقفل الرسالة.</small></div>
    <div className="credential-actions"><button type="button" className="secondary-button compact" onClick={async () => { await navigator.clipboard.writeText(`${username}\n${password}`); setCopied(true); }}><Copy />{copied ? "اتنسخت" : "نسخ"}</button><button type="button" className="icon-button" aria-label="إخفاء بيانات الدخول" onClick={onDismiss}><X /></button></div>
  </div>;
}

function Teams({ data }: { data: AdminDashboard }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ id?: string; nameAr: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => repository.saveTeam({ eventId: data.event.id, ...form! }),
    onSuccess: async () => {
      setOpen(false);
      setForm(null);
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const deleteM = useMutation({
    mutationFn: () => repository.deleteTeam(deleting!),
    onSuccess: async () => {
      setDeleting(null);
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  return (
    <div className="admin-section">
      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">{data.teams.length} فرق</p>
            <h2>الفرق</h2>
          </div>
          <button
            className="secondary-button compact"
            onClick={() => { setForm({ nameAr: "" }); setOpen(true); }}
          >
            <Plus />
            فريق
          </button>
        </div>
        {open && form && (
          <form
            className="inline-editor"
            onSubmit={(e) => {
              e.preventDefault();
              m.mutate();
            }}
          >
            <div className="form-header">
              <h3>{form.id ? "تعديل الفريق" : "فريق جديد"}</h3>
              <button
                type="button"
                className="icon-button"
                onClick={() => { setOpen(false); setForm(null); }}
              >
                <X />
              </button>
            </div>
            <label>
              اسم الفريق
              <input
                required
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              />
            </label>
            {feedback(m)}
            <button className="primary-button">{form.id ? "حفظ التعديل" : "إضافة الفريق"}</button>
          </form>
        )}
        <div className="management-list">
          {data.teams.map((t) => (
            <article key={t.id}>
              <div className="team-monogram">{t.nameAr[0]}</div>
              <div>
                <strong>{t.nameAr}</strong>
                <small>الرصيد {data.balances[t.id] ?? 0} Kaizen</small>
              </div>
              <div className="row-actions">
                <button className="text-button" onClick={() => { setForm({ id: t.id, nameAr: t.nameAr }); setOpen(true); }} aria-label={`تعديل ${t.nameAr}`}><Pencil /></button>
                <button className="text-button destructive-text" onClick={() => setDeleting(t.id)} aria-label={`حذف ${t.nameAr}`}><Trash2 /></button>
              </div>
              {deleting === t.id && (
                <div className="confirmation-panel danger-confirm management-confirm">
                  <strong>حذف {t.nameAr}؟</strong>
                  <p>ينفع فقط لو الفريق ملوش Slots أو حركة Kaizen أو كارت NFC.</p>
                  <div className="action-row"><button className="danger-button" type="button" onClick={() => deleteM.mutate()} disabled={deleteM.isPending}>تأكيد الحذف</button><button className="secondary-button" type="button" onClick={() => setDeleting(null)}>إلغاء</button></div>
                  {feedback(deleteM)}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

const freshSlot = (data: AdminDashboard, scorerId = "") => ({
  // An empty id tells upsert_slot_v2 to create a slot. Supplying a freshly
  // generated UUID made the database correctly treat it as a missing update.
  id: "",
  slotNumber: String(Math.max(0, ...data.slots.map((slot) => slot.slotNumber)) + 1),
  labelAr: "",
  scheduledAt: new Date().toISOString().slice(0, 16),
  scorerId: scorerId || data.scorers[0]?.userId || "",
  slotType: "game" as SlotType,
  participantTeamIds: data.teams.slice(0, 2).map((t) => t.id),
  winnerScore: "50",
  drawScore: "25",
  loserScore: "20",
  firstScore: "175",
  secondScore: "125",
  thirdScore: "75",
  othersScore: "30",
  bonusLimit: "15",
});
type SlotForm = ReturnType<typeof freshSlot>;
function SlotEditor({
  data,
  initial,
  onClose,
}: {
  data: AdminDashboard;
  initial: SlotForm;
  onClose: () => void;
}) {
  const [f, setF] = useState(initial);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      repository.saveSlot({
        id: f.id,
        eventId: data.event.id,
        slotNumber: Number(f.slotNumber),
        labelAr: f.labelAr,
        scheduledAt: new Date(f.scheduledAt).toISOString(),
        scorerId: f.scorerId,
        slotType: f.slotType,
        participantTeamIds: f.participantTeamIds,
        winnerScore: Number(f.winnerScore),
        drawScore: Number(f.drawScore),
        loserScore: Number(f.loserScore),
        firstScore: Number(f.firstScore),
        secondScore: Number(f.secondScore),
        thirdScore: Number(f.thirdScore),
        othersScore: Number(f.othersScore),
        bonusLimit: Number(f.bonusLimit),
      }),
    onSuccess: async () => {
      onClose();
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const toggle = (id: string) =>
    setF({
      ...f,
      participantTeamIds: f.participantTeamIds.includes(id)
        ? f.participantTeamIds.filter((x) => x !== id)
        : [...f.participantTeamIds, id],
    });
  const valid =
    f.slotType === "game"
      ? f.participantTeamIds.length === 2
      : f.participantTeamIds.length >= 4;
  return (
    <form
      className="inline-editor slot-editor"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <div className="form-header">
        <h3>
          {data.slots.some((s) => s.id === f.id)
            ? "تعديل الـSlot"
            : "Slot جديد"}
        </h3>
        <button type="button" className="icon-button" onClick={onClose}>
          <X />
        </button>
      </div>
      <div className="slot-type-picker">
        <button
          type="button"
          className={f.slotType === "game" ? "selected" : ""}
          onClick={() =>
            setF({
              ...f,
              slotType: "game",
              participantTeamIds: f.participantTeamIds.slice(0, 2),
            })
          }
        >
          Game<small>فوز، تعادل، خسارة</small>
        </button>
        <button
          type="button"
          className={f.slotType === "tournament" ? "selected" : ""}
          onClick={() => setF({ ...f, slotType: "tournament" })}
        >
          Tournament<small>أول، تاني، تالت، والباقي</small>
        </button>
      </div>
      <label>
        الاسم والمكان
        <input
          required
          value={f.labelAr}
          onChange={(e) => setF({ ...f, labelAr: e.target.value })}
        />
      </label>
      <label>
        الـScorer
        <select
          value={f.scorerId}
          onChange={(e) => setF({ ...f, scorerId: e.target.value })}
        >
          {data.scorers.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.displayName}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>
          {f.slotType === "game"
            ? "اختار فريقين بالظبط"
            : "اختار 4 فرق أو أكتر"}
        </legend>
        <div className="team-check-grid">
          {data.teams.map((t) => (
            <label className="check-label" key={t.id}>
              <input
                type="checkbox"
                checked={f.participantTeamIds.includes(t.id)}
                onChange={() => toggle(t.id)}
              />
              {t.nameAr}
            </label>
          ))}
        </div>
      </fieldset>
      {!valid && (
        <div className="inline-alert error">
          <AlertTriangle />
          عدد الفرق مش مناسب لنوع الـSlot.
        </div>
      )}
      <div className="score-settings">
        {f.slotType === "game" ? (
          <>
            <label>
              الفائز
              <input
                type="number"
                value={f.winnerScore}
                onChange={(e) => setF({ ...f, winnerScore: e.target.value })}
              />
            </label>
            <label>
              التعادل
              <input
                type="number"
                value={f.drawScore}
                onChange={(e) => setF({ ...f, drawScore: e.target.value })}
              />
            </label>
            <label>
              الخاسر
              <input
                type="number"
                value={f.loserScore}
                onChange={(e) => setF({ ...f, loserScore: e.target.value })}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              الأول
              <input
                type="number"
                value={f.firstScore}
                onChange={(e) => setF({ ...f, firstScore: e.target.value })}
              />
            </label>
            <label>
              التاني
              <input
                type="number"
                value={f.secondScore}
                onChange={(e) => setF({ ...f, secondScore: e.target.value })}
              />
            </label>
            <label>
              التالت
              <input
                type="number"
                value={f.thirdScore}
                onChange={(e) => setF({ ...f, thirdScore: e.target.value })}
              />
            </label>
            <label>
              الباقي
              <input
                type="number"
                value={f.othersScore}
                onChange={(e) => setF({ ...f, othersScore: e.target.value })}
              />
            </label>
          </>
        )}
      </div>
      <label>
        أقصى Bonus للـSlot
        <input
          type="number"
          min="0"
          required
          value={f.bonusLimit}
          onChange={(e) => setF({ ...f, bonusLimit: e.target.value })}
        />
        <small>الـScorer يقدر يضيف Bonus لحد السقف ده قبل تسجيل النتيجة فقط.</small>
      </label>
      {feedback(m)}
      <button className="primary-button" disabled={!valid || m.isPending}>
        {m.isPending ? "جاري الحفظ" : "حفظ الـSlot"}
      </button>
    </form>
  );
}

const editShape = (s: Slot): SlotForm => ({
  id: s.id,
  slotNumber: String(s.slotNumber),
  labelAr: s.labelAr,
  scheduledAt: new Date(s.scheduledAt).toISOString().slice(0, 16),
  scorerId: s.scorerId,
  slotType: s.slotType,
  participantTeamIds: s.participants.map((p) => p.teamId),
  winnerScore: String(s.winnerScore),
  drawScore: String(s.drawScore),
  loserScore: String(s.loserScore),
  firstScore: String(s.firstScore),
  secondScore: String(s.secondScore),
  thirdScore: String(s.thirdScore),
  othersScore: String(s.othersScore),
  bonusLimit: String(s.bonusLimit),
});
function SlotList({
  data,
  filter,
  onAdd,
}: {
  data: AdminDashboard;
  filter?: string;
  onAdd?: () => void;
}) {
  const [edit, setEdit] = useState<SlotForm | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<Slot | null>(null);
  const [correction, setCorrection] = useState({
    teamId: "",
    amount: "",
    reason: "",
  });
  const [reviewCorrection, setReviewCorrection] = useState(false);
  const qc = useQueryClient();
  const intent = useRef(createIntentKeyTracker());
  const deleteM = useMutation({
    mutationFn: () => repository.deleteSlot(deleting!),
    onSuccess: async () => {
      setDeleting(null);
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const correctionM = useMutation({
    mutationFn: () =>
      repository.adjustWallet(
        correction.teamId,
        Number(correction.amount),
        correction.reason,
        intent.current.get(
          `${correcting?.id}|${correction.teamId}|${correction.amount}|${correction.reason}`,
        ),
      ),
    onSuccess: async () => {
      intent.current.clear();
      setCorrecting(null);
      setCorrection({ teamId: "", amount: "", reason: "" });
      setReviewCorrection(false);
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const openCorrection = (slot: Slot) => {
    setCorrecting(slot);
    setCorrection({
      teamId: slot.participants[0]?.teamId ?? "",
      amount: "",
      reason: "",
    });
    setReviewCorrection(false);
  };
  const list = filter
    ? data.slots.filter((s) => s.scorerId === filter)
    : data.slots;
  return (
    <>
      {edit && (
        <SlotEditor data={data} initial={edit} onClose={() => setEdit(null)} />
      )}
      <div className="slot-admin-list">
        {list.map((s) => (
          <article key={s.id}>
            <strong>{s.labelAr}</strong>
            <p>
              {s.slotType === "game"
                ? `${s.teamAName} ضد ${s.teamBName}`
                : `Tournament، ${s.participants.length} فرق`}
            </p>
            <small>
              {s.scorerName}، Bonus {s.bonusUsed}/{s.bonusLimit}
            </small>
            {!s.isSubmitted ? (
              <div className="row-actions">
                <button className="text-button" onClick={() => setEdit(editShape(s))}><Pencil />تعديل</button>
                <button className="text-button destructive-text" onClick={() => setDeleting(s.id)}><Trash2 />حذف</button>
              </div>
            ) : (
              <div className="row-actions">
                <button className="text-button" type="button" onClick={() => openCorrection(s)}>
                  <Coins />تصحيح النقاط
                </button>
              </div>
            )}
            {deleting === s.id && (
              <div className="confirmation-panel danger-confirm">
                <strong>حذف الـSlot؟</strong>
                <p>الـSlot اللي اتسجلت له نتيجة أو Bonus لا يمكن حذفه لحماية السجل.</p>
                <div className="action-row"><button className="danger-button" type="button" disabled={deleteM.isPending} onClick={() => deleteM.mutate()}>تأكيد الحذف</button><button className="secondary-button" type="button" onClick={() => setDeleting(null)}>إلغاء</button></div>
                {feedback(deleteM)}
              </div>
            )}
            {correcting?.id === s.id && (
              <form
                className="slot-correction"
                onSubmit={(event) => {
                  event.preventDefault();
                  setReviewCorrection(true);
                }}
              >
                <div className="correction-heading">
                  <div>
                    <span><Coins /> تصحيح مسجل</span>
                    <p>التعديل يظهر كحركة منفصلة ويحافظ على النتيجة الأصلية.</p>
                  </div>
                  <button type="button" className="icon-button" onClick={() => setCorrecting(null)} aria-label="إلغاء التصحيح"><X /></button>
                </div>
                <div className="correction-fields">
                  <label>
                    الفريق
                    <select value={correction.teamId} onChange={(event) => { setCorrection({ ...correction, teamId: event.target.value }); setReviewCorrection(false); }}>
                      {correcting.participants.map((team) => <option key={team.teamId} value={team.teamId}>{team.teamName}</option>)}
                    </select>
                  </label>
                  <label>
                    النقاط
                    <input type="number" required value={correction.amount} placeholder="+20 أو -20" onChange={(event) => { setCorrection({ ...correction, amount: event.target.value }); setReviewCorrection(false); }} />
                  </label>
                </div>
                <label>
                  السبب
                  <input required maxLength={240} value={correction.reason} placeholder="سبب التعديل" onChange={(event) => { setCorrection({ ...correction, reason: event.target.value }); setReviewCorrection(false); }} />
                </label>
                {reviewCorrection && (
                  <div className="confirmation-panel">
                    <strong>تأكيد الحركة</strong>
                    <p>{correcting.participants.find((team) => team.teamId === correction.teamId)?.teamName}: {Number(correction.amount) > 0 ? "+" : ""}{correction.amount} Kaizen</p>
                    <div className="action-row">
                      <button type="button" className="primary-button" disabled={correctionM.isPending} onClick={() => correctionM.mutate()}>{correctionM.isPending ? <LoaderCircle className="spin" /> : <Check />}تأكيد</button>
                      <button type="button" className="secondary-button" onClick={() => setReviewCorrection(false)}>رجوع</button>
                    </div>
                  </div>
                )}
                {feedback(correctionM)}
                {!reviewCorrection && <button className="secondary-button correction-review" disabled={!correction.teamId || !correction.reason.trim() || Number(correction.amount) === 0}>مراجعة التصحيح</button>}
              </form>
            )}
          </article>
        ))}
        {!list.length && (
          <div className="empty-state compact-empty">
            <Trophy />
            <h2>مفيش Slots هنا</h2>
            <p>ضيف أول Slot وعيّن الفرق والنقاط.</p>
          </div>
        )}
      </div>
      {onAdd && (
        <button className="primary-button" onClick={onAdd}>
          <Plus />
          إضافة Slot للـScorer ده
        </button>
      )}
    </>
  );
}

function Scorers({ data }: { data: AdminDashboard }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [addSlot, setAddSlot] = useState(false);
  const [savedCredential, setSavedCredential] = useState<{ username: string; password: string } | null>(null);
  const [form, setForm] = useState<{
    userId?: string;
    displayName: string;
    username: string;
    initialPassword: string;
    newPassword: string;
    isActive: boolean;
  } | null>(null);
  const m = useMutation({
    mutationFn: () =>
      repository.saveScorer({ eventId: data.event.id, ...form! }),
    onSuccess: async () => {
      const password = form?.newPassword || form?.initialPassword;
      if (form && password) setSavedCredential({ username: form.username, password });
      setForm(null);
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const current = data.scorers.find((s) => s.userId === selected);
  if (current)
    return (
      <div className="admin-section">
        <button className="text-button" onClick={() => setSelected(null)}>
          رجوع لكل الـScorers
        </button>
        <section>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Slots المسؤول عنها</p>
              <h2>{current.displayName}</h2>
              <small>@{current.username}</small>
            </div>
            <button
              className="secondary-button compact"
              onClick={() =>
                setForm({
                  userId: current.userId,
                  displayName: current.displayName,
                  username: current.username ?? "",
                  initialPassword: "",
                  newPassword: "",
                  isActive: current.isActive,
                })
              }
            >
              إدارة الحساب
            </button>
          </div>
          {savedCredential && <CredentialReceipt {...savedCredential} onDismiss={() => setSavedCredential(null)} />}
          {form && <ScorerForm form={form} setForm={setForm} mutation={m} />}{" "}
          {addSlot && (
            <SlotEditor
              data={data}
              initial={freshSlot(data, current.userId)}
              onClose={() => setAddSlot(false)}
            />
          )}
          <SlotList
            data={data}
            filter={current.userId}
            onAdd={() => setAddSlot(true)}
          />
        </section>
      </div>
    );
  return (
    <div className="admin-section">
      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">{data.scorers.length} حساب</p>
            <h2>Scorers</h2>
          </div>
          <button
            className="secondary-button compact"
            onClick={() =>
              setForm({
                displayName: "",
                username: "",
                initialPassword: "",
                newPassword: "",
                isActive: true,
              })
            }
          >
            <Plus />
            حساب
          </button>
        </div>
        {savedCredential && <CredentialReceipt {...savedCredential} onDismiss={() => setSavedCredential(null)} />}
        {form && <ScorerForm form={form} setForm={setForm} mutation={m} />}
        <div className="management-list">
          {data.scorers.map((s) => (
            <button
              className="scorer-row"
              key={s.userId}
              onClick={() => setSelected(s.userId)}
            >
              <div>
                <strong>{s.displayName}</strong>
                <small>
                  @{s.username}،{" "}
                  {data.slots.filter((x) => x.scorerId === s.userId).length}{" "}
                  Slots
                </small>
              </div>
              <span>عرض الجدول ←</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
function ScorerForm({
  form,
  setForm,
  mutation,
}: {
  form: {
    userId?: string;
    displayName: string;
    username: string;
    initialPassword: string;
    newPassword: string;
    isActive: boolean;
  };
  setForm: (v: null | typeof form) => void;
  mutation: {
    mutate: () => void;
    isPending: boolean;
    error: Error | null;
    isSuccess: boolean;
  };
}) {
  const generateForAccount = () => {
    const password = generatePassword();
    setForm(form.userId ? { ...form, newPassword: password } : { ...form, initialPassword: password });
  };
  return (
    <form
      className="inline-editor"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="form-header">
        <h3>{form.userId ? "إدارة الحساب" : "Scorer جديد"}</h3>
        <button
          type="button"
          className="icon-button"
          onClick={() => setForm(null)}
        >
          <X />
        </button>
      </div>
      <label>
        الاسم
        <input
          required
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        />
      </label>
      <label>
        Username
        <input
          dir="ltr"
          disabled={!!form.userId}
          required
          value={form.username}
          onChange={(e) =>
            setForm({ ...form, username: e.target.value.toLowerCase() })
          }
        />
      </label>
      {!form.userId && (
        <label>
          كلمة السر
          <input
            dir="ltr"
            type="text"
            autoComplete="new-password"
            minLength={8}
            required
            value={form.initialPassword}
            onChange={(e) =>
              setForm({ ...form, initialPassword: e.target.value })
            }
          />
          <button type="button" className="secondary-button compact password-generator" onClick={generateForAccount}><KeyRound />Generate password</button>
        </label>
      )}
      {form.userId && (
        <>
          <label>
            كلمة سر جديدة (اختياري)
            <input
              dir="ltr"
              type="text"
              autoComplete="new-password"
              minLength={8}
              value={form.newPassword}
              onChange={(e) =>
                setForm({ ...form, newPassword: e.target.value })
              }
            />
            <small>الـpassword الحالية مش قابلة للعرض. ولّد واحدة جديدة، انسخها، وبعدها احفظ الحساب.</small>
            <button type="button" className="secondary-button compact password-generator" onClick={generateForAccount}><KeyRound />Generate new password</button>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            الحساب نشط
          </label>
        </>
      )}
      {feedback(mutation)}
      <button className="primary-button" disabled={mutation.isPending}>
        حفظ الحساب
      </button>
    </form>
  );
}

function Slots({ data }: { data: AdminDashboard }) {
  const slotsPerPage = 10;
  const [add, setAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [scorerId, setScorerId] = useState("all");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const filtered = data.slots.filter((slot) => {
    const words = `${slot.labelAr} ${slot.teamAName} ${slot.teamBName} ${slot.scorerName}`.toLowerCase();
    return (!query || words.includes(query.trim().toLowerCase())) &&
      (scorerId === "all" || slot.scorerId === scorerId) &&
      (type === "all" || slot.slotType === type) &&
      (status === "all" || (status === "done" ? Boolean(slot.isSubmitted) : !slot.isSubmitted));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / slotsPerPage));
  const currentPage = Math.min(page, totalPages);
  const pageSlots = filtered.slice((currentPage - 1) * slotsPerPage, currentPage * slotsPerPage);
  return (
    <div className="admin-section">
      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Game وTournament</p>
            <h2>كل الـSlots</h2>
          </div>
          <button
            className="secondary-button compact"
            onClick={() => setAdd(true)}
          >
            <Plus />
            Slot
          </button>
        </div>
        {add && (
          <SlotEditor
            data={data}
            initial={freshSlot(data)}
            onClose={() => setAdd(false)}
          />
        )}
        <div className="slot-filters" aria-label="فلترة الـSlots">
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="بحث بالاسم أو الفريق" />
          <div className="two-fields"><select value={scorerId} onChange={(e) => { setScorerId(e.target.value); setPage(1); }}><option value="all">كل الـScorers</option>{data.scorers.map((scorer) => <option key={scorer.userId} value={scorer.userId}>{scorer.displayName}</option>)}</select><select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="all">كل الأنواع</option><option value="game">Game</option><option value="tournament">Tournament</option></select></div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="all">كل الحالات</option><option value="pending">لسه متسجلش</option><option value="done">تم التسجيل</option></select>
          <small>ظاهر {filtered.length} من {data.slots.length} Slot</small>
        </div>
        <SlotList data={{ ...data, slots: pageSlots }} />
        {filtered.length > slotsPerPage && (
          <nav className="pagination" aria-label="صفحات الـSlots">
            <button className="secondary-button compact" type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}>السابق</button>
            <span>صفحة {currentPage} من {totalPages}</span>
            <button className="secondary-button compact" type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === totalPages}>التالي</button>
          </nav>
        )}
      </section>
    </div>
  );
}

function Spend({ data }: { data: AdminDashboard }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"spend" | "add">("spend");
  const [f, setF] = useState({
    teamId: data.teams[0]?.id ?? "",
    amount: "",
    note: "",
  });
  const [confirm, setConfirm] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);
  const intent = useRef(createIntentKeyTracker());
  const team = data.teams.find((t) => t.id === f.teamId);
  const current = data.balances[f.teamId] ?? 0;
  const m = useMutation({
    mutationFn: () =>
      repository.spendKaizen(
        f.teamId,
        Number(f.amount),
        f.note,
        intent.current.get(`${f.teamId}|${f.amount}|${f.note}`),
      ),
    onSuccess: async () => {
      intent.current.clear();
      setConfirm(false);
      setF({ ...f, amount: "", note: "" });
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const addM = useMutation({
    mutationFn: () =>
      repository.adjustWallet(
        f.teamId,
        Number(f.amount),
        f.note,
        intent.current.get(`${f.teamId}|add|${f.amount}|${f.note}`),
      ),
    onSuccess: async () => {
      intent.current.clear();
      setConfirm(false);
      setF({ ...f, amount: "", note: "" });
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const activeM = mode === "spend" ? m : addM;
  const scanTeamCard = async () => {
    setScanError(null);
    setScanSuccess(null);
    setIsScanning(true);
    try {
      const capability = await readNfcCapability();
      const wallet = await repository.getWallet(capability);
      const scannedTeam = data.teams.find(
        (candidate) => candidate.code === wallet.team.code && candidate.nameAr === wallet.team.nameAr,
      );
      if (!scannedTeam) {
        throw new Error("الكارت لفريق خارج الكامب الحالي.");
      }
      setConfirm(false);
      setF((currentForm) => ({ ...currentForm, teamId: scannedTeam.id }));
      setScanSuccess(`تم اختيار فريق ${scannedTeam.nameAr}.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setScanError("اسمح للمتصفح باستخدام NFC ثم جرّب تاني.");
      } else if (error instanceof DOMException && error.name === "NotSupportedError") {
        setScanError("مسح NFC يحتاج Chrome على Android وHTTPS.");
      } else {
        setScanError(error instanceof Error ? error.message : "تعذّر قراءة الكارت. جرّب تاني.");
      }
    } finally {
      setIsScanning(false);
    }
  };
  return (
    <div className="admin-section">
      <section className="charge-hero">
        <WalletCards />
        <p className="eyebrow">كل حركة بتتسجل بسببها</p>
        <h2>إدارة Kaizen</h2>
        <p>أضف Kaizen أو اصرفها من فريق، مع مراجعة وتأكيد جوه الموقع.</p>
      </section>
      <div className="mode-switch" role="group" aria-label="نوع إدارة Kaizen">
        <button className={mode === "spend" ? "active" : ""} type="button" onClick={() => { setMode("spend"); setConfirm(false); }}>صرف Kaizen</button>
        <button className={mode === "add" ? "active" : ""} type="button" onClick={() => { setMode("add"); setConfirm(false); }}>إضافة Kaizen</button>
      </div>
      <form
        className="inline-editor prominent"
        onSubmit={(e) => {
          e.preventDefault();
          setConfirm(true);
        }}
      >
        <div className="team-selector">
          <span className="field-label" id="wallet-team-label">الفريق</span>
          <select
            aria-labelledby="wallet-team-label"
            value={f.teamId}
            onChange={(e) => {
              setConfirm(false);
              setF({ ...f, teamId: e.target.value });
            }}
          >
            {data.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nameAr}، {data.balances[t.id] ?? 0} Kaizen
              </option>
              ))}
          </select>
          <button
            type="button"
            className="secondary-button nfc-scan-button"
            disabled={!canReadNfc() || isScanning}
            onClick={scanTeamCard}
          >
            {isScanning ? <LoaderCircle className="spin" /> : <SmartphoneNfc />}
            {isScanning ? "قرّب الكارت من الموبايل" : "امسح كارت NFC"}
          </button>
          {!canReadNfc() && <small className="nfc-scan-hint">المسح متاح من Chrome على Android عبر HTTPS. تقدر تختار الفريق يدويًا.</small>}
          {scanError && <div className="inline-alert error" role="alert"><AlertTriangle />{scanError}</div>}
          {scanSuccess && <div className="inline-alert success" role="status"><Check />{scanSuccess}</div>}
        </div>
        <label>
          القيمة
          <input
            type="number"
            min="1"
            max={mode === "spend" ? current : undefined}
            required
            value={f.amount}
            onChange={(e) => {
              setConfirm(false);
              setF({ ...f, amount: e.target.value });
            }}
          />
        </label>
        <label>
          السبب
          <input
            required
            maxLength={240}
            value={f.note}
            onChange={(e) => {
              setConfirm(false);
              setF({ ...f, note: e.target.value });
            }}
          />
        </label>
        {confirm && (
          <div className="confirmation-panel">
              <strong>{mode === "spend" ? "راجع عملية الصرف" : "راجع إضافة Kaizen"}</strong>
              <p>
              {team?.nameAr}: {mode === "spend" ? "خصم" : "إضافة"} {f.amount} Kaizen
              </p>
              <p>
              الرصيد: {current} ← <b>{mode === "spend" ? current - Number(f.amount) : current + Number(f.amount)} Kaizen</b>
            </p>
            <p>الغرض: {f.note}</p>
            <div className="action-row">
              <button
                type="button"
                className="primary-button"
                disabled={activeM.isPending}
                onClick={() => activeM.mutate()}
              >
                {activeM.isPending ? <LoaderCircle className="spin" /> : <Check />}
                {mode === "spend" ? "تأكيد الصرف" : "تأكيد الإضافة"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirm(false)}
              >
                مراجعة
              </button>
            </div>
          </div>
        )}
        {feedback(activeM)}
        {!confirm && (
          <button
            className="primary-button"
            disabled={
              !f.teamId || Number(f.amount) < 1 || (mode === "spend" && Number(f.amount) > current)
            }
          >
            مراجعة العملية
          </button>
        )}
      </form>
    </div>
  );
}

function Cards({ data }: { data: AdminDashboard }) {
  const qc = useQueryClient();
  const [issue, setIssue] = useState({ teamId: data.teams[0]?.id ?? "" });
  const [secret, setSecret] = useState<string | null>(null);
  const [reassign, setReassign] = useState<{
    id: string;
    teamId: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);
  const nfcAvailability = getNfcWriteAvailability();
  const issueM = useMutation({
    mutationFn: () => repository.issueNfc(issue.teamId),
    onSuccess: async (raw) => {
      setSecret(raw);
      setUrlCopied(false);
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const reassignM = useMutation({
    mutationFn: () => repository.reassignNfc(reassign!.id, reassign!.teamId),
    onSuccess: async (raw) => {
      setSecret(raw);
      setUrlCopied(false);
      setReassign(null);
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const deleteM = useMutation({
    mutationFn: () => repository.deleteNfc(deleting!),
    onSuccess: async () => {
      setDeleting(null);
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const url = secret
    ? `${location.origin}/nfc#${encodeURIComponent(secret)}`
    : "";
  return (
    <div className="admin-section">
      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Read only</p>
            <h2>كروت NFC</h2>
          </div>
          <CreditCard />
        </div>
        <form
          className="simple-form"
          onSubmit={(e) => {
            e.preventDefault();
            issueM.mutate();
          }}
        >
          <label>
            الفريق
            <select
              value={issue.teamId}
              onChange={(e) => setIssue({ ...issue, teamId: e.target.value })}
            >
              {data.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nameAr}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button" disabled={!!secret}>
            إصدار كارت جديد
          </button>
          {secret && (
            <div className="secret-action">
              <SmartphoneNfc />
              <div>
                <strong>الرابط الجديد جاهز للكتابة</strong>
                <p>
                  اكتبه على الكارت، أي Scan هيفتح الرصيد والـhistory للقراءة
                  فقط.
                </p>
              </div>
              <div className="nfc-write-actions">
                {nfcAvailability === "ios" && <div className="inline-alert error"><AlertTriangle />Safari على iPhone/iPad لا يسمح بكتابة NFC من المتصفح. استخدم Chrome على Android أو انسخ الرابط.</div>}
                {nfcAvailability === "unsupported" && <div className="inline-alert error"><AlertTriangle />المتصفح ده لا يدعم كتابة NFC. استخدم Chrome على Android أو انسخ الرابط.</div>}
                {nfcAvailability === "insecure" && <div className="inline-alert error"><AlertTriangle />كتابة NFC تحتاج HTTPS، لكن تقدر تنسخ الرابط.</div>}
                {writeError && <div className="inline-alert error"><AlertTriangle />{writeError}</div>}
                <div className="nfc-write-buttons">
                  <button type="button" className="secondary-button" onClick={async () => { try { await navigator.clipboard.writeText(url); setUrlCopied(true); setWriteError(null); } catch (error) { if (error instanceof DOMException) { setWriteError("تعذر نسخ الرابط. دوس مطولًا عليه وانسخه يدويًا."); return; } throw error; } }}><Copy />{urlCopied ? "تم نسخ الرابط" : "نسخ الرابط"}</button>
                  <button type="button" className="primary-button" disabled={!canWriteNfc()} onClick={async () => { try { setWriteError(null); await writeUrlToNfc(url); setSecret(null); } catch (error) { if (error instanceof DOMException) { setWriteError("تعذرت الكتابة. قرب الكارت من الموبايل وخليه مفتوح لحد ما تظهر رسالة النجاح."); return; } throw error; } }}>اكتب على كارت NFC</button>
                </div>
                <code className="nfc-url" dir="ltr">{url}</code>
              </div>
            </div>
          )}
        </form>
      </section>
      <section>
        <div className="token-list">
          {data.nfcTokens.map((t) => (
            <article key={t.id}>
              <div>
                <strong>
                  {data.teams.find((x) => x.id === t.teamId)?.nameAr}
                </strong>
                <small>{t.revokedAt ? "متوقف" : "كارت الفريق"}</small>
              </div>
              <div className="action-row">
                <button
                  className="text-button"
                  onClick={() => setReassign({ id: t.id, teamId: t.teamId })}
                >
                  إعادة تعيين
                </button>
                <button
                  className="danger-button"
                  onClick={() => setDeleting(t.id)}
                >
                  حذف
                </button>
              </div>
              {reassign?.id === t.id && (
                <div className="confirmation-panel">
                  <strong>إعادة تعيين الكارت</strong>
                  <select
                    value={reassign.teamId}
                    onChange={(e) =>
                      setReassign({ ...reassign, teamId: e.target.value })
                    }
                  >
                    {data.teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.nameAr}
                      </option>
                    ))}
                  </select>
                  <p>لازم تكتب رابط الفريق الجديد على الكارت بعد التعيين.</p>
                  <button
                    className="primary-button"
                    onClick={() => reassignM.mutate()}
                  >
                    تأكيد إعادة التعيين
                  </button>
                </div>
              )}
              {deleting === t.id && (
                <div className="confirmation-panel danger-confirm">
                  <strong>حذف الكارت نهائيًا؟</strong>
                  <p>
                    الكارت الموجود مع الفريق هيبطل يفتح. العملية دي مش بتتم من
                    غير التأكيد.
                  </p>
                  <button
                    className="danger-button"
                    onClick={() => deleteM.mutate()}
                  >
                    تأكيد الحذف
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setDeleting(null)}
                  >
                    إلغاء
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Overview({ data }: { data: AdminDashboard }) {
  return (
    <div className="admin-section">
      <section className="event-pulse">
        <div>
          <LayoutDashboard size={16} />
          الحدث مفتوح
        </div>
        <h2>{data.event.name}</h2>
        <p>
          {data.slots.length} Slots، {data.scorers.length} Scorers،{" "}
          {data.teams.length} فرق
        </p>
      </section>
      <section>
        <h2>أرصدة الفرق</h2>
        <div className="balance-list">
          {data.teams.map((t, i) => (
            <div key={t.id}>
              <span className="rank">{i + 1}</span>
              <strong>{t.nameAr}</strong>
              <b>
                {data.balances[t.id] ?? 0}
                <small> Kaizen</small>
              </b>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
export function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const q = useQuery({
    queryKey: ["admin"],
    queryFn: () => repository.getAdminDashboard(),
  });
  return (
    <main className="page admin-page">
      <header className="page-heading">
        <p className="eyebrow">غرفة التحكم</p>
        <h1>إدارة ليلة الكامب</h1>
      </header>
      <nav className="admin-tabs admin-tabs--scroll" aria-label="أقسام الإدارة">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <button
        className="refresh-button"
        onClick={() => q.refetch()}
        disabled={q.isFetching}
      >
        <RefreshCw className={q.isFetching ? "spin" : ""} />
        تحديث
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
          حصلت مشكلة في التحميل.
        </div>
      )}
      {q.data &&
        (tab === "overview" ? (
          <Overview data={q.data} />
        ) : tab === "teams" ? (
          <Teams data={q.data} />
        ) : tab === "scorers" ? (
          <Scorers data={q.data} />
        ) : tab === "slots" ? (
          <Slots data={q.data} />
        ) : tab === "spend" ? (
          <Spend data={q.data} />
        ) : (
          <Cards data={q.data} />
        ))}
    </main>
  );
}
