import { onlineLink, useOnlineStore } from "../online/onlineLink.js";
import { useGameStore } from "../store/gameStore.js";
import { useT } from "../i18n/index.js";

/**
 * ネット対戦の対局中にサーバーとの接続が切れた時の案内。切れている間も
 * 対局はサーバー側で進み（自分の手番は時間切れと同じ自動操作になる）、
 * 入り直すと同じ席に戻れる。
 */
export function OnlineConnectionOverlay() {
  const t = useT();
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
            <p>{t("onlineConnectionOverlay.t1")}</p>
          ) : (
            <>
              <p>{t("onlineConnectionOverlay.t2")}</p>
              <p>{t("onlineConnectionOverlay.t3")}</p>
              {autoRejoining && <p>{t("onlineConnectionOverlay.t4")}</p>}
              {error && <p className="online-lobby__error">{error}</p>}
              <div className="setup-buttons">
                <button className="btn btn--primary" onClick={() => onlineLink.rejoin()}>
                  {t("onlineConnectionOverlay.t5")}
                </button>
                <button className="btn btn--secondary" onClick={backToTitle}>
                  {t("matchVictoryOverlay.t2")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
