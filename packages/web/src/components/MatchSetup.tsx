import { useState } from "react";
import { CARDS, CHARACTERS, type AiDifficulty, type MatchFormat } from "@majyan/core";
import { useGameStore, type CpuDifficultySettings } from "../store/gameStore.js";

const CHARACTER_LIST = Object.values(CHARACTERS);
const CARD_LIST = Object.values(CARDS);

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

export function MatchSetup() {
  const startMatch = useGameStore((s) => s.startMatch);
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
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  // キャラ・カードともに種類が増えて一覧を常時表示するとトップ画面が
  // ごちゃつくため、選択中の1件だけを常時表示し、詳しい一覧はクリックで
  // 開く別モーダル（ピッカー）に追い出す。
  const [showCharacterPicker, setShowCharacterPicker] = useState(false);
  const [showCardPicker, setShowCardPicker] = useState(false);
  const selectedCharacter = selectedCharacterId ? CHARACTERS[selectedCharacterId] : undefined;
  const selectedCard = selectedCardId ? CARDS[selectedCardId] : undefined;

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
      selectedCardId ?? undefined,
      cpuCharacterIds,
    );
  }

  return (
    <div className="setup-screen">
      <h1>雀神 - 対戦型麻雀</h1>
      <p>CPU3人と対局します。対局形式を選んでください。</p>

      <div className="setup-summary-row">
        <button type="button" className="setup-summary-card" onClick={() => setShowCharacterPicker(true)}>
          <div className="setup-summary-card__label">自分のキャラクター</div>
          {selectedCharacter ? (
            <img className="setup-summary-card__avatar" src={selectedCharacter.avatar} alt="" />
          ) : (
            <div className="setup-summary-card__avatar setup-summary-card__avatar--random">？</div>
          )}
          <div className="setup-summary-card__name">{selectedCharacter?.name ?? "おまかせ"}</div>
          <div className="setup-summary-card__hint">タップして選択</div>
        </button>
        <button type="button" className="setup-summary-card" onClick={() => setShowCardPicker(true)}>
          <div className="setup-summary-card__label">持っていくカード</div>
          <div className="setup-summary-card__avatar setup-summary-card__avatar--random">
            {selectedCard ? (selectedCard.kind === "passive" ? "常時" : "消費") : "－"}
          </div>
          <div className="setup-summary-card__name">{selectedCard?.name ?? "なし"}</div>
          <div className="setup-summary-card__hint">タップして選択</div>
        </button>
      </div>

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

      {showCardPicker && (
        <div className="modal-overlay" onClick={() => setShowCardPicker(false)}>
          <div className="setup-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="setup-picker-modal__header">
              <div className="setup-character-select__label">持っていくカード（1枚まで・自分専用）</div>
              <button type="button" className="setup-picker-modal__close" onClick={() => setShowCardPicker(false)}>
                ×
              </button>
            </div>
            <div className="setup-character-select__grid setup-picker-modal__grid">
              <button
                type="button"
                className={`character-card card-card${selectedCardId === null ? " character-card--selected" : ""}`}
                onClick={() => {
                  setSelectedCardId(null);
                  setShowCardPicker(false);
                }}
              >
                <div className="character-card__avatar character-card__avatar--random">－</div>
                <div className="character-card__name">
                  <div className="character-card__shortname">なし</div>
                </div>
              </button>
              {CARD_LIST.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`character-card card-card${selectedCardId === c.id ? " character-card--selected" : ""}`}
                  onClick={() => {
                    setSelectedCardId(c.id);
                    setShowCardPicker(false);
                  }}
                  title={c.description}
                >
                  <div className="character-card__avatar character-card__avatar--random card-card__kind">
                    {c.kind === "passive" ? "常時" : "消費"}
                  </div>
                  <div className="character-card__name">
                    <div className="character-card__shortname">{c.name}</div>
                  </div>
                  <div className="card-card__desc">{c.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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

      <div className="setup-buttons">
        <button className="btn btn--primary btn--large" onClick={() => start("tonpuusen")}>
          東風戦
        </button>
        <button className="btn btn--primary btn--large" onClick={() => start("hanchan")}>
          半荘戦
        </button>
      </div>
      <label className="setup-debug-toggle">
        <input
          type="checkbox"
          checked={continueBelowZero}
          onChange={(e) => setContinueBelowZero(e.target.checked)}
        />
        箱下続行（オフの場合、誰かが0点未満になった時点で対局を即終了します）
      </label>
      <label className="setup-debug-toggle">
        <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
        デバッグモード（CPUは和了しない・CPUの手番を早送り・巻き戻し可能）
      </label>
    </div>
  );
}
