import { useState } from "react";
import { forgetAccountForTesting, resetCollectionForTesting } from "../online/account.js";

type Pending = "forget" | "reset" | null;

/**
 * 開発用のアカウント操作（最初の10連などを何度も試すため）。npm run dev の時だけ出す。
 * どちらも取り返しがつかないので、押したら確認を挟む。
 * 画面の右下に浮かせた小さな「開発用」ボタンで、押した時だけ開く（ロビーのパネルの
 * 高さを取らず、スクロールバーの原因にならないようにするため）。
 */
export function DevAccountTools() {
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function run() {
    setError(null);
    try {
      if (pending === "forget") forgetAccountForTesting();
      else if (pending === "reset") await resetCollectionForTesting();
    } catch (err) {
      setError((err as Error).message);
    }
    setPending(null);
  }

  if (!open) {
    return (
      <button type="button" className="dev-account-tools dev-account-tools--float dev-account-tools__toggle" onClick={() => setOpen(true)}>
        開発用
      </button>
    );
  }

  return (
    <div className="dev-account-tools dev-account-tools--float dev-account-tools--open">
      <button type="button" className="dev-account-tools__toggle" onClick={() => setOpen(false)}>
        開発用 ▾
      </button>
      {pending === null ? (
        <>
          <button type="button" className="btn online-lobby__rename" onClick={() => setPending("reset")}>
            最初の10連をやり直す
          </button>
          <button type="button" className="btn online-lobby__rename" onClick={() => setPending("forget")}>
            新しいアカウントで始める
          </button>
        </>
      ) : (
        <>
          <span className="dev-account-tools__warn">
            {pending === "reset"
              ? "手持ちのキャラ・カードと交換ポイントを消して、最初の10連の前に戻します（雀玉・段位はそのまま）。"
              : "このブラウザからアカウントを外します。引き継ぎのパスワードを決めていなければ、今のアカウントには戻れません。"}
          </span>
          <button type="button" className="btn online-lobby__rename" onClick={() => void run()}>
            実行する
          </button>
          <button type="button" className="btn online-lobby__rename" onClick={() => setPending(null)}>
            やめる
          </button>
        </>
      )}
      {error && <span className="online-lobby__error">{error}</span>}
    </div>
  );
}
