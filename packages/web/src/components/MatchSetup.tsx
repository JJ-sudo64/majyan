import { useState } from "react";
import { CARDS, CHARACTERS, type AiDifficulty, type MatchFormat } from "@majyan/core";
import { useGameStore, type CpuDifficultySettings } from "../store/gameStore.js";
import { playUiClickFor } from "../sound.js";
import { CardSlot, CardSlotPicker, slotLabel, type SlotKind } from "./CardSlot.js";

const CHARACTER_LIST = Object.values(CHARACTERS);
/** その種類のカードのID（定義順）。カード欄を開いた時の選択肢になる。 */
function cardIdsOfKind(kind: SlotKind): string[] {
  return Object.values(CARDS)
    .filter((c) => c.kind === kind)
    .map((c) => c.id);
}

/** 各CPU席のキャラクター指定。null = おまかせ（ランダム）。 */
type CpuCharacterSettings = [string | null, string | null, string | null, string | null];

/** キャラ名は「異名・名前」の形式で統一されている。カード幅が狭いと
    ブラウザ任せの折り返しが変な位置（漢字の途中等）で起きて読みにくいため、
    「・」の位置で明示的に2行（上段=異名、下段=名前）に分けて表示する。
    区切りが無い名前が来ても崩れないよう、その場合は1行にフォールバックする。 */
function splitCharacterName(fullName: string): { title: string; shortName: string } {
  const sep = fullName.indexOf("・");
  if (sep === -1) return { title: "", shortName: fullName };
  return { title: fullName.slice(0, sep), shortName: fullName.slice(sep + 1) };
}

const DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  1: "Lv1 初心者",
  2: "Lv2 弱め",
  3: "Lv3 普通",
  4: "Lv4 強め",
  5: "Lv5 最強",
};
const DIFFICULTY_OPTIONS: AiDifficulty[] = [1, 2, 3, 4, 5];

/** OpponentArea.tsxのNAMESと表記を合わせてある（下家→対面→上家の順）。 */
const CPU_SEATS: { player: 1 | 2 | 3; label: string }[] = [
  { player: 1, label: "下家CPU" },
  { player: 2, label: "対面CPU" },
  { player: 3, label: "上家CPU" },
];

export function MatchSetup({ onBack, onOnline }: { onBack: () => void; onOnline: () => void }) {
  const startMatch = useGameStore((s) => s.startMatch);
  const startTutorial = useGameStore((s) => s.startTutorial);
  const [debugMode, setDebugMode] = useState(false);
  // デフォルトは箱割れ（誰かが0点未満になった時点で）即終了。チェックを入れると
  // 箱下続行（それを無視して最終局まで続ける）ルールになる。
  const [continueBelowZero, setContinueBelowZero] = useState(false);
  const [cpuDifficulty, setCpuDifficulty] = useState<CpuDifficultySettings>([2, 2, 2, 2]);
  /** 各CPU席のキャラクター。null = おまかせ（ランダム）。index 0(自分)は
      使わないが、cpuDifficultyと同様PlayerIndexでそのまま添字アクセス
      できるよう4要素にしておく。 */
  const [cpuCharacterIds, setCpuCharacterIds] = useState<CpuCharacterSettings>([null, null, null, null]);
  /** null = おまかせ（ランダム） */
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  /** キャラカードをクリックした直後、確定前に絵をドンと見せて確認する対象。 */
  const [confirmingCharacterId, setConfirmingCharacterId] = useState<string | null>(null);
  const confirmingCharacter = confirmingCharacterId ? CHARACTERS[confirmingCharacterId] : undefined;
  // カードはキャラと違いCPU対象外の人間専用要素で、おまかせ（ランダム割り当て）
  // という概念が無いため、null=「なし」がそのままデフォルトになる。
  // パッシブ1枚＋アクティブ（消費型）1枚まで。選んだカードの種類で、どちらの枠に入るかが決まる。
  const [selectedPassiveId, setSelectedPassiveId] = useState<string | null>(null);
  const [selectedActiveId, setSelectedActiveId] = useState<string | null>(null);
  // キャラ・カードともに種類が増えて一覧を常時表示するとトップ画面が
  // ごちゃつくため、選択中の1件だけを常時表示し、詳しい一覧はクリックで
  // 開く別モーダル（ピッカー）に追い出す。
  const [showCharacterPicker, setShowCharacterPicker] = useState(false);
  // 開いているカード欄（パッシブ欄／アクティブ欄）。null = 閉じている。
  const [openSlot, setOpenSlot] = useState<SlotKind | null>(null);
  // カードを付ける別画面（パッシブ欄・アクティブ欄だけの画面）を出しているか。トップにはカード欄を置かない
  // （カード欄が大きく、選んだキャラの絵が隠れるため）。
  const [showLoadout, setShowLoadout] = useState(false);
  const attachedCardCount = (selectedPassiveId ? 1 : 0) + (selectedActiveId ? 1 : 0);
  const selectedCharacter = selectedCharacterId ? CHARACTERS[selectedCharacterId] : undefined;

  function setSeatDifficulty(player: 1 | 2 | 3, level: AiDifficulty) {
    setCpuDifficulty((prev) => {
      const next = [...prev] as CpuDifficultySettings;
      next[player] = level;
      return next;
    });
  }

  function setSeatCharacter(player: 1 | 2 | 3, characterId: string | null) {
    setCpuCharacterIds((prev) => {
      const next = [...prev] as CpuCharacterSettings;
      next[player] = characterId;
      return next;
    });
  }

  function start(format: MatchFormat) {
    startMatch(
      format,
      debugMode,
      cpuDifficulty,
      selectedCharacterId ?? undefined,
      continueBelowZero,
      selectedPassiveId ?? undefined,
      cpuCharacterIds,
      selectedActiveId ?? undefined,
    );
  }

  return (
    // 見た目はオンラインのホーム画面（OnlineLobby.tsx）と共通の .online-home / .oh-* を使う。
    <div className="online-home match-setup" onClickCapture={playUiClickFor}>
      <header className="oh-top">
        <button type="button" className="oh-back" onClick={showLoadout ? () => setShowLoadout(false) : onBack}>
          {showLoadout ? "← 戻る" : "← タイトルへ"}
        </button>
        <div className="oh-top__title">{showLoadout ? "CARD" : "PLAY"}</div>
        <div className="oh-top__spacer" />
        {/* 何度も見返す確認用ページ（CutinGallery.tsx / QuoteGallery.tsx）。別タブで
            開くので、この画面で選んだキャラや設定はそのまま残る。 */}
        <div className="setup-gallery-links" style={showLoadout ? { display: "none" } : undefined}>
          <button type="button" className="oh-ghost setup-tutorial-btn" onClick={startTutorial}>
            チュートリアル
          </button>
          <a className="oh-ghost" href="?cutin-gallery" target="_blank" rel="noreferrer">
            カットイン一覧
          </a>
          <a className="oh-ghost" href="?quote-gallery" target="_blank" rel="noreferrer">
            勝利台詞一覧
          </a>
          <a className="oh-ghost" href="/about/" target="_blank" rel="noreferrer">
            公式サイト
          </a>
        </div>
      </header>

      {showLoadout ? (
        <main className="oh-main cardloadout">
          <section className="cardloadout__body">
            <div className="cardloadout__who">
              {selectedCharacter && <img src={selectedCharacter.avatar} alt="" />}
              <div>
                <div className="oh-plate__label">自分のキャラクター</div>
                <div className="oh-plate__name">{selectedCharacter?.name ?? "おまかせ"}</div>
              </div>
            </div>
            <p className="cardloadout__lead">
              パッシブ（常に効く）とアクティブ（自分で使う）を、1枚ずつ付けられます。CPU戦では、全カードから自由に選べます。
            </p>
            <div className="cardloadout__slots">
              <CardSlot kind="passive" cardId={selectedPassiveId} onOpen={() => setOpenSlot("passive")} />
              <CardSlot kind="consumable" cardId={selectedActiveId} onOpen={() => setOpenSlot("consumable")} />
            </div>
            <button type="button" className="oh-ghost cardloadout__done" onClick={() => setShowLoadout(false)}>
              決定して戻る
            </button>
          </section>
        </main>
      ) : (
      <main className="oh-main">
        <section className="oh-stage">
          {selectedCharacter && (
            <img
              key={selectedCharacter.id}
              className={`oh-stage__art${selectedCharacter.topArt ? " oh-stage__art--top" : selectedCharacter.cutin ? "" : " oh-stage__art--avatar"}`}
              src={selectedCharacter.topArt ?? selectedCharacter.cutin ?? selectedCharacter.avatar}
              alt=""
            />
          )}
          <div className="oh-plate">
            <div className="oh-plate__label">自分のキャラクター</div>
            <div className="oh-plate__name">{selectedCharacter?.name ?? "おまかせ"}</div>
            <div className="oh-plate__sub">
              {selectedCharacter ? `必殺技「${selectedCharacter.skill.name}」` : "ランダムに割り当てます"}
            </div>
            <div className="oh-plate__buttons">
              <button type="button" className="oh-ghost" onClick={() => setShowCharacterPicker(true)}>
                キャラを選ぶ
              </button>
              <button type="button" className="oh-ghost" onClick={() => setShowLoadout(true)}>
                カードを付ける（{attachedCardCount}/2）
              </button>
            </div>
          </div>
        </section>

        <section className="oh-panel">
          <button type="button" className="oh-card oh-card--online setup-online-btn" onClick={onOnline}>
            <span className="oh-card__head">
              <span className="oh-card__title">オンライン</span>
              <span className="oh-card__en">ONLINE</span>
            </span>
            <span className="oh-card__lead">段位戦・友人戦・ガチャ。ほかの人と打つならこちら。</span>
            <span className="oh-card__arrow">›</span>
          </button>

          <div className="oh-card oh-card--ranked">
            <div className="oh-card__head">
              <span className="oh-card__title">CPU戦</span>
              <span className="oh-card__en">VS CPU</span>
            </div>
            <p className="oh-card__lead">CPU3人と対局します。全キャラ・全カードを自由に使えます。</p>
            <div className="setup-cpu-difficulty">
              {CPU_SEATS.map(({ player, label }) => (
                <div key={player} className="setup-cpu-difficulty__row">
                  <span className="setup-cpu-difficulty__name">{label}</span>
                  <div className="setup-cpu-difficulty__selects">
                    <select
                      value={cpuCharacterIds[player] ?? ""}
                      onChange={(e) => setSeatCharacter(player, e.target.value || null)}
                      title="キャラクター"
                    >
                      <option value="">おまかせ</option>
                      {CHARACTER_LIST.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={cpuDifficulty[player]}
                      onChange={(e) => setSeatDifficulty(player, Number(e.target.value) as AiDifficulty)}
                      title="難易度"
                    >
                      {DIFFICULTY_OPTIONS.map((level) => (
                        <option key={level} value={level}>
                          {DIFFICULTY_LABELS[level]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
            <div className="oh-modes">
              <button type="button" className="oh-mode" onClick={() => start("tonpuusen")}>
                <span className="oh-mode__kanji">東</span>
                <span className="oh-mode__name">東風戦</span>
                <span className="oh-mode__sub">東場のみ・短め</span>
              </button>
              <button type="button" className="oh-mode" onClick={() => start("hanchan")}>
                <span className="oh-mode__kanji">南</span>
                <span className="oh-mode__name">半荘戦</span>
                <span className="oh-mode__sub">東場＋南場・じっくり</span>
              </button>
            </div>
            <label className="setup-debug-toggle">
              <input type="checkbox" checked={continueBelowZero} onChange={(e) => setContinueBelowZero(e.target.checked)} />
              箱下続行（オフだと、誰かが0点未満になった時点で終了）
            </label>
            <label className="setup-debug-toggle">
              <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
              デバッグモード（CPUは和了しない・早送り・巻き戻し可能）
            </label>
          </div>
        </section>
      </main>
      )}

      {showCharacterPicker && (
        <div className="modal-overlay" onClick={() => setShowCharacterPicker(false)}>
          <div className="setup-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="setup-picker-modal__header">
              <div className="setup-character-select__label">自分のキャラクター</div>
              <button type="button" className="setup-picker-modal__close" onClick={() => setShowCharacterPicker(false)}>
                ×
              </button>
            </div>
            <div className="setup-character-select__grid setup-picker-modal__grid">
              <button
                type="button"
                className={`character-card${selectedCharacterId === null ? " character-card--selected" : ""}`}
                onClick={() => {
                  setSelectedCharacterId(null);
                  setShowCharacterPicker(false);
                  setShowLoadout(true);
                }}
              >
                <div className="character-card__avatar character-card__avatar--random">？</div>
                <div className="character-card__name">おまかせ</div>
                <div className="character-card__desc">ランダムに割り当てます</div>
              </button>
              {CHARACTER_LIST.map((c) => {
                const { title, shortName } = splitCharacterName(c.name);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`character-card${selectedCharacterId === c.id ? " character-card--selected" : ""}`}
                    onClick={() => setConfirmingCharacterId(c.id)}
                  >
                    <img className="character-card__avatar" src={c.avatar} alt="" />
                    <div className="character-card__name">
                      {title && <div className="character-card__title">{title}</div>}
                      <div className="character-card__shortname">{shortName}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {confirmingCharacter && (
        <div className="modal-overlay" onClick={() => setConfirmingCharacterId(null)}>
          <div className="character-confirm" onClick={(e) => e.stopPropagation()}>
            <img
              className="character-confirm__art"
              src={confirmingCharacter.cutin ?? confirmingCharacter.avatar}
              alt=""
            />
            <div className="character-confirm__name">{confirmingCharacter.name}</div>
            <div className="character-confirm__skill">
              必殺技「{confirmingCharacter.skill.name}」: {confirmingCharacter.skill.description}
            </div>
            <div className="character-confirm__prompt">このキャラクターでよろしいですか？</div>
            <div className="character-confirm__buttons">
              <button
                className="btn btn--primary"
                onClick={() => {
                  setSelectedCharacterId(confirmingCharacter.id);
                  setConfirmingCharacterId(null);
                  setShowCharacterPicker(false);
                  setShowLoadout(true);
                }}
              >
                このキャラクターにする
              </button>
              <button className="btn btn--secondary" onClick={() => setConfirmingCharacterId(null)}>
                やめる
              </button>
            </div>
          </div>
        </div>
      )}

      {openSlot && (
        <CardSlotPicker
          kind={openSlot}
          title={`${slotLabel(openSlot)}に入れるカード`}
          candidates={cardIdsOfKind(openSlot)}
          current={openSlot === "passive" ? selectedPassiveId : selectedActiveId}
          emptyMessage="カードがありません。"
          onConfirm={(id) => {
            if (openSlot === "passive") setSelectedPassiveId(id);
            else setSelectedActiveId(id);
            setOpenSlot(null);
          }}
          onClear={() => {
            if (openSlot === "passive") setSelectedPassiveId(null);
            else setSelectedActiveId(null);
            setOpenSlot(null);
          }}
          onClose={() => setOpenSlot(null)}
        />
      )}

    </div>
  );
}
