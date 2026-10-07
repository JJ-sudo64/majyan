import { useEffect, useState } from "react";
import { TRANSFER_PASSWORD_MAX_LENGTH, TRANSFER_PASSWORD_MIN_LENGTH, formatTransferCode } from "@majyan/core";
import { fetchTransferCode, loginWithTransfer, setTransferPassword, useAccountStore } from "../online/account.js";

/**
 * 引き継ぎ。今のアカウントに引き継ぎのパスワードを決める（コードはサーバーが作る）のと、
 * 別の端末で決めたコードとパスワードでこのブラウザに入るのの2つ。
 * アカウントがまだ無い時は、入る方だけを出す。
 */
export function TransferScreen({ onClose }: { onClose: () => void }) {
  const profile = useAccountStore((s) => s.profile);
  /** 今のアカウントの引き継ぎコード。undefined=読み込み中、null=まだ決めていない。 */
  const [code, setCode] = useState<string | null | undefined>(profile ? undefined : null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [justSet, setJustSet] = useState(false);
  const [loginCode, setLoginCode] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [abandonOk, setAbandonOk] = useState(false);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="gacha-screen transfer-screen" onClick={(e) => e.stopPropagation()}>
        <div className="setup-picker-modal__header">
          <div className="setup-character-select__label">引き継ぎ</div>
          <button type="button" className="setup-picker-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        {profile && (
          <section className="transfer-screen__section">
            <div className="online-lobby__section-title">この端末のアカウントを引き継げるようにする</div>
            <p className="setup-lead">
              パスワードを決めると引き継ぎコードが発行されます。ブラウザのデータを消した時や別の端末で遊ぶ時に、コードとパスワードで今のアカウント（雀玉・キャラ・段位）に戻れます。
            </p>
            {code === undefined && <p className="setup-lead">確認しています…</p>}
            {code && (
              <div className="transfer-screen__code">
                <span>引き継ぎコード</span>
                <strong>{formatTransferCode(code)}</strong>
              </div>
            )}
            {code && justSet && (
              <p className="transfer-screen__note">コードとパスワードを、メモやスクリーンショットで控えておいてください。パスワードはあとから表示できません。</p>
            )}
            {code !== undefined && (
              <div className="online-lobby__form">
                <label className="online-lobby__field">
                  <span>
                    {code ? "新しいパスワード" : "パスワード"}（{TRANSFER_PASSWORD_MIN_LENGTH}文字以上）
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    maxLength={TRANSFER_PASSWORD_MAX_LENGTH}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label className="online-lobby__field">
                  <span>もう一度</span>
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
                  {code ? "パスワードを変える" : "パスワードを決める"}
                </button>
              </div>
            )}
            {password2 !== "" && password !== password2 && <p className="online-lobby__error">2つのパスワードが違います</p>}
            {setupError && <p className="online-lobby__error">{setupError}</p>}
          </section>
        )}

        {profile && (
          <p className="transfer-screen__note">
            アカウントID（お問い合わせの時にお伝えください）: <strong>{profile.id.slice(0, 8)}</strong>
          </p>
        )}

        <section className="transfer-screen__section">
          <div className="online-lobby__section-title">引き継ぎコードで入る</div>
          <p className="setup-lead">別の端末で発行した引き継ぎコードとパスワードを入れると、このブラウザでそのアカウントを使えます（元の端末でもそのまま遊べます）。</p>
          {profile && (
            <p className="transfer-screen__note">
              このブラウザの今のアカウント（{profile.displayName} さん）とは入れ替わります。
              {code ? "今のアカウントには、上の引き継ぎコードで戻れます。" : "今のアカウントは引き継ぎのパスワードを決めていないので、入れ替えると二度と戻れません。"}
            </p>
          )}
          <div className="online-lobby__form">
            <label className="online-lobby__field">
              <span>引き継ぎコード</span>
              <input value={loginCode} autoComplete="username" placeholder="XXXX-XXXX-XXXX" onChange={(e) => setLoginCode(e.target.value)} />
            </label>
            <label className="online-lobby__field">
              <span>パスワード</span>
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
              {busy ? "確認中…" : "このアカウントで入る"}
            </button>
          </div>
          {loginError && <p className="online-lobby__error">{loginError}</p>}
        </section>
      </div>
    </div>
  );
}
