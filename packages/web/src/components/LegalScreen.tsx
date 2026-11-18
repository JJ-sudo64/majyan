import { useState } from "react";
import { PRIVACY_SECTIONS, TERMS_SECTIONS, TERMS_VERSION, type LegalSection } from "@majyan/core";
import { acceptTerms, useAccountStore } from "../online/account.js";
import { useT } from "../i18n/index.js";

type LegalTab = "terms" | "privacy";

function LegalBody({ sections }: { sections: readonly LegalSection[] }) {
  const t = useT();
  return (
    <div className="legal-screen__body">
      {sections.map((s) => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          <p style={{ whiteSpace: "pre-line" }}>{s.body}</p>
        </section>
      ))}
      <p className="legal-screen__version">{t("legalScreen.t6", { TERMS_VERSION })}</p>
    </div>
  );
}

function LegalTabs({ tab, setTab }: { tab: LegalTab; setTab: (tab: LegalTab) => void }) {
  const t = useT();
  return (
    <div className="inbox-screen__tabs">
      <button type="button" className={`inbox-screen__tab${tab === "terms" ? " is-active" : ""}`} onClick={() => setTab("terms")}>
        {t("legalScreen.t1")}
      </button>
      <button type="button" className={`inbox-screen__tab${tab === "privacy" ? " is-active" : ""}`} onClick={() => setTab("privacy")}>
        {t("legalScreen.t2")}
      </button>
    </div>
  );
}

/** 利用規約とプライバシーポリシーを読む画面。 */
export function LegalScreen({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<LegalTab>("terms");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen inbox-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <LegalTabs tab={tab} setTab={setTab} />
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        <LegalBody sections={tab === "terms" ? TERMS_SECTIONS : PRIVACY_SECTIONS} />
      </div>
    </div>
  );
}

/**
 * 利用規約・プライバシーポリシーが新しくなった後（または同意の記録を始める前に作った
 * アカウントで）開いた時に、同意をもらう画面。同意するまで閉じられない。
 */
export function TermsConsent() {
  const t = useT();
  const [tab, setTab] = useState<LegalTab>("terms");
  const [busy, setBusy] = useState(false);
  const error = useAccountStore((s) => s.error);
  return (
    <div className="modal-overlay">
      <div className="gacha-screen inbox-screen">
        <div className="setup-character-select__label">{t("legalScreen.t3")}</div>
        <p className="setup-lead">{t("legalScreen.t4")}</p>
        <LegalTabs tab={tab} setTab={setTab} />
        <LegalBody sections={tab === "terms" ? TERMS_SECTIONS : PRIVACY_SECTIONS} />
        {error && <p className="online-lobby__error">{error}</p>}
        <div className="setup-buttons">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void acceptTerms().finally(() => setBusy(false));
            }}
          >
            {t("legalScreen.t5")}
          </button>
        </div>
      </div>
    </div>
  );
}
