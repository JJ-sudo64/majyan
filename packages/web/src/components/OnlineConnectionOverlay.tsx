import { onlineLink, useOnlineStore } from "../online/onlineLink.js";
import { useGameStore } from "../store/gameStore.js";

/**
 * ネット対戦の対局中にサーバーとの接続が切れた時の案内。切れている間も
 * 対局はサーバー側で進み（自分の手番は時間切れと同じ自動操作になる）、
 * 入り直すと同じ席に戻れる。
 */
export function OnlineConnectionOverlay() {
  const status = useOnlineStore((s) => s.status);
  const error = useOnlineStore((s) => s.error);
  const autoRejoining = useOnlineStore((s) => s.autoRejoining);
  const backToTitle = useGameStore((s) => s.backToTitle);
  if (status === "playing") return null;

  return (
    <div className="modal-overlay online-connection-overlay">
      <div className="title-modal">
        <div className="title-modal__body">
          {status === "connecting" ? (
            <p>サーバーに接続し直しています…</p>
          ) : (
            <>
              <p>サーバーとの接続が切れました。</p>
              <p>切れている間も対局は進みます（自分の手番は自動でツモ切りになります）。入り直すと同じ席に戻れます。</p>
              {autoRejoining && <p>自動で入り直そうとしています…</p>}
              {error && <p className="online-lobby__error">{error}</p>}
              <div className="setup-buttons">
                <button className="btn btn--primary" onClick={() => onlineLink.rejoin()}>
                  入り直す
                </button>
                <button className="btn btn--secondary" onClick={backToTitle}>
                  タイトルへ戻る
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
