import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Coins,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  SmartphoneNfc,
} from "lucide-react";
import logo from "../../Logo.jpeg";
import { repository } from "../data";
import { getNfcCapability } from "../lib/nfcBootstrap";
import type { LedgerKind } from "../types";

const dateTime = new Intl.DateTimeFormat("ar-EG", {
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
});
const kindLabels: Record<LedgerKind, string> = {
  match: "نتيجة",
  bonus: "Bonus",
  redemption: "صرف",
  reversal: "تصحيح",
  adjustment: "تسوية",
};
export function NfcPage() {
  const capability = getNfcCapability();
  const wallet = useQuery({
    queryKey: ["public-wallet"],
    queryFn: () => repository.getWallet(capability!),
    enabled: Boolean(capability),
    staleTime: 0,
  });
  return (
    <main className="nfc-page">
      <header>
        <img src={logo} alt="Saint Paul Sports Team" />
      </header>
      {!capability && (
        <section className="nfc-status">
          <SmartphoneNfc />
          <h1>مرّر كارت الفريق</h1>
          <p>الصفحة دي بتفتح من كارت NFC الخاص بالفريق.</p>
        </section>
      )}
      {wallet.isLoading && (
        <section className="nfc-status">
          <LoaderCircle className="spin" />
          <h1>بنقرأ رصيد الفريق</h1>
          <p>ثواني ونجيب الحركات.</p>
        </section>
      )}
      {wallet.isError && (
        <section className="nfc-status">
          <AlertTriangle />
          <h1>الكارت مش متاح</h1>
          <p>الكارت غير صالح أو تم إيقافه. ارجع لمسؤول الكامب.</p>
          <button className="secondary-button" onClick={() => wallet.refetch()}>
            <RefreshCw />
            إعادة المحاولة
          </button>
        </section>
      )}
      {wallet.data && (
        <>
          <section className="team-identity">
            <div className="team-code">{wallet.data.team.code}</div>
            <p className="eyebrow">رصيد الفريق</p>
            <h1>{wallet.data.team.nameAr}</h1>
            <div className="public-balance">
              <Coins />
              <strong>{wallet.data.balance}</strong>
              <span>Kaizen</span>
            </div>
            <div className="safe-note">
              <ShieldCheck />
              عرض فقط، مفيش صرف أو تعديل من الصفحة دي
            </div>
          </section>
          <section className="public-history">
            <div className="section-heading">
              <div>
                <p className="eyebrow">حساب واضح</p>
                <h2>آخر الحركات</h2>
              </div>
              <button
                className="icon-button"
                aria-label="تحديث الرصيد"
                disabled={wallet.isFetching}
                onClick={() => wallet.refetch()}
              >
                <RefreshCw className={wallet.isFetching ? "spin" : ""} />
              </button>
            </div>
            {wallet.data.transactions.length === 0 ? (
              <div className="empty-state">
                <Coins />
                <h2>مفيش حركات لسه</h2>
                <p>أول نتيجة أو Bonus هيظهر هنا.</p>
              </div>
            ) : (
              <div className="public-ledger">
                {wallet.data.transactions.map((entry, index) => (
                  <article key={`${entry.createdAt}-${index}`}>
                    <div
                      className={
                        entry.amount > 0
                          ? "movement-icon in"
                          : "movement-icon out"
                      }
                    >
                      {entry.amount > 0 ? <ArrowUp /> : <ArrowDown />}
                    </div>
                    <div>
                      <strong>{entry.descriptionAr}</strong>
                      <small>
                        {kindLabels[entry.kind]}،{" "}
                        {dateTime.format(new Date(entry.createdAt))}
                      </small>
                    </div>
                    <b className={entry.amount > 0 ? "positive" : "negative"}>
                      {entry.amount > 0 ? "+" : ""}
                      {entry.amount}
                    </b>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
