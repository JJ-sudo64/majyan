import { useEffect, useState } from "react";
import { ACCOUNT_DELETE_CONFIRM, TRANSFER_PASSWORD_MAX_LENGTH, TRANSFER_PASSWORD_MIN_LENGTH, formatTransferCode } from "@majyan/core";
import { deleteAccount, fetchTransferCode, loginWithTransfer, regenerateTransferCode, setTransferPassword, useAccountStore } from "../online/account.js";
import { useT } from "../i18n/index.js";

/**
 * 引き継ぎ。今のアカウントに引き継ぎのパスワードを決める（コードはサーバーが作る）のと、
 * 別の端末で決めたコードとパスワードでこのブラウザに入るのの2つ。
 * アカウントがまだ無い時は、入る方だけを出す。
 */
export function TransferScreen({ onClose, justCreated = false }: { onClose: () => void; justCreated?: boolean }) {
  const t = useT();
  const profile = useAccountStore((s) => s.profile);
  const jade = useAccountStore((s) => s.jade);
  /** 今のアカウントの引き継ぎコード。undefined=読み込み中、null=まだ決めていない。 */
  const [code, setCode] = useState<string | null | undefined>(profile ? undefined : null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [justSet, setJustSet] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [loginCode, setLoginCode] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [abandonOk, setAbandonOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    fetchTransferCode()
      .then(setCode)
      .catch((err: Error) => {
        setCode(null);
        setSetupError(err.message);
      });
  }, [profile?.id]);

  const passwordLength = [...password].length;
  const canSet = passwordLength >= TRANSFER_PASSWORD_MIN_LENGTH && password === password2 && !busy;
  // 今のアカウントに戻る手段が無いまま入れ替えると、そのアカウントには二度と戻れない。
  const needsAbandonOk = !!profile && code === null;
  const canLogin = loginCode.trim() !== "" && loginPassword !== "" && (!needsAbandonOk || abandonOk) && !busy;

  async function submitPassword() {
    if (!canSet) return;
    setBusy(true);
    setSetupError(null);
    try {
      setCode(await setTransferPassword(password));
      setPassword("");
      setPassword2("");
      setJustSet(true);
    } catch (err) {
      setSetupError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitRegenerate() {
    if (busy) return;
    setBusy(true);
    setSetupError(null);
    try {
      setCode(await regenerateTransferCode());
      setJustSet(true);
      setConfirmRegenerate(false);
    } catch (err) {
      setSetupError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitLogin() {
    if (!canLogin) return;
    setBusy(true);
    setLoginError(null);
    try {
      await loginWithTransfer(loginCode, loginPassword);
      onClose();
    } catch (err) {
      setLoginError((err as Error).message);
      setBusy(false);
    }
  }

  async function submitDelete() {
    if (deleteConfirm !== ACCOUNT_DELETE_CONFIRM || busy) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount(deleteConfirm);
      onClose();
    } catch (err) {
      setDeleteError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen transfer-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="setup-character-select__label">{profile ? t("onlineLobby.t18") : t("transferScreen.t14")}</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        {profile && (
          <section className="transfer-screen__section">
            <div className="online-lobby__section-title">{t("transferScreen.t1")}</div>
            <p className="setup-lead">
              {t("transferScreen.t2")}
            </p>
            {code === undefined && <p className="setup-lead">{t("transferScreen.t3")}</p>}
            {code && (
              <div className="transfer-screen__code">
                <span>{t("transferScreen.t4")}</span>
                <strong>{formatTransferCode(code)}</strong>
              </div>
            )}
            {code && (justSet || justCreated) && (
              <p className="transfer-screen__note">{t("transferScreen.t5")}</p>
            )}
            {code && (
              <div className="transfer-screen__regenerate">
                {!confirmRegenerate ? (
                  <button type="button" className="btn btn--secondary" onClick={() => setConfirmRegenerate(true)}>
                    {t("transferScreen.t6")}
                  </button>
                ) : (
                  <>
                    <p className="transfer-screen__note">
                      {t("transferScreen.t7")}
                    </p>
                    <div className="setup-buttons">
                      <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void submitRegenerate()}>
                        {busy ? t("transferScreen.t15") : t("transferScreen.t16")}
                      </button>
                      <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => setConfirmRegenerate(false)}>
                        {t("cardSlot.t7")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {code !== undefined && (
              <div className="online-lobby__form">
                <label className="online-lobby__field">
                  <span>{t("transferScreen.t17", { v1: code ? t("transferScreen.t26") : t("transferScreen.t11"), TRANSFER_PASSWORD_MIN_LENGTH })}</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    maxLength={TRANSFER_PASSWORD_MAX_LENGTH}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label className="online-lobby__field">
                  <span>{t("onlineLobby.t8")}</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password2}
                    maxLength={TRANSFER_PASSWORD_MAX_LENGTH}
                    onChange={(e) => setPassword2(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submitPassword();
                    }}
                  />
                </label>
                <button type="button" className="btn btn--primary" disabled={!canSet} onClick={() => void submitPassword()}>
                  {code ? t("transferScreen.t18") : t("transferScreen.t19")}
                </button>
              </div>
            )}
            {password2 !== "" && password !== password2 && <p className="online-lobby__error">{t("transferScreen.t8")}</p>}
            {setupError && <p className="online-lobby__error">{setupError}</p>}
          </section>
        )}

        {profile && (
          <p className="transfer-screen__note">
            アカウントID（お問い合わせの時にお伝えください）: <strong>{profile.id.slice(0, 8)}</strong>
          </p>
        )}

        <section className="transfer-screen__section">
          <div className="online-lobby__section-title">{t("transferScreen.t9")}</div>
          <p className="setup-lead">{t("transferScreen.t10")}</p>
          {profile && (
            <p className="transfer-screen__note">{t("transferScreen.t20", { displayName: profile.displayName, v1: code ? t("transferScreen.t27") : t("transferScreen.t28") })}</p>
          )}
          <div className="online-lobby__form">
            <label className="online-lobby__field">
              <span>{t("transferScreen.t4")}</span>
              <input value={loginCode} autoComplete="username" placeholder="XXXX-XXXX-XXXX" onChange={(e) => setLoginCode(e.target.value)} />
            </label>
            <label className="online-lobby__field">
              <span>{t("transferScreen.t11")}</span>
              <input
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                maxLength={TRANSFER_PASSWORD_MAX_LENGTH}
                onChange={(e) => setLoginPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitLogin();
                }}
              />
            </label>
            {needsAbandonOk && (
              <label className="setup-debug-toggle">
                <input type="checkbox" checked={abandonOk} onChange={(e) => setAbandonOk(e.target.checked)} />
                今のアカウントに戻れなくなってもよい
              </label>
            )}
            <button type="button" className="btn btn--primary" disabled={!canLogin} onClick={() => void submitLogin()}>
              {busy ? t("transferScreen.t21") : t("transferScreen.t22")}
            </button>
          </div>
          {loginError && <p className="online-lobby__error">{loginError}</p>}
        </section>

        {profile && (
          <section className="transfer-screen__section">
            {!showDelete ? (
              <button type="button" className="btn btn--secondary transfer-screen__delete-open" onClick={() => setShowDelete(true)}>
                {t("transferScreen.t12")}
              </button>
            ) : (
              <>
                <div className="online-lobby__section-title">{t("transferScreen.t13")}</div>
                <p className="transfer-screen__note">{t("transferScreen.t23", { displayName: profile.displayName })}</p>
                {jade && jade.paid > 0 && (
                  <p className="online-lobby__error">{t("transferScreen.t24", { v1: jade.paid.toLocaleString() })}</p>
                )}
                <label className="online-lobby__field">
                  <span>{t("transferScreen.t25", { ACCOUNT_DELETE_CONFIRM })}</span>
                  <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} />
                </label>
                <div className="setup-buttons">
                  <button
                    type="button"
                    className="btn transfer-screen__delete"
                    disabled={deleteConfirm !== ACCOUNT_DELETE_CONFIRM || busy}
                    onClick={() => void submitDelete()}
                  >
                    {t("transferScreen.t12")}
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={() => setShowDelete(false)}>
                    {t("cardSlot.t7")}
                  </button>
                </div>
                {deleteError && <p className="online-lobby__error">{deleteError}</p>}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
