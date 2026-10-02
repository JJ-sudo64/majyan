import { useState } from "react";
import { forgetAccountForTesting, resetCollectionForTesting } from "../online/account.js";

type Pending = "forget" | "reset" | null;

/**
 * 開発用のアカウント操作（最初の10連などを何度も試すため）。npm run dev の時だけ出す。
 * どちらも取り返しがつかないので、押したら確認を挟む。
 */
export function DevAccountTools() {
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="dev-account-tools">
      <span className="dev-account-tools__label">開発用</span>
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
