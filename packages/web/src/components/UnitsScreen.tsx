import { useMemo, useState } from "react";
import { CARDS, CARD_IDS, CHARACTERS, CHARACTER_IDS, cardRarity, characterRarity, type CharacterUnit, type Rarity } from "@majyan/core";
import { equipCard, useAccountStore } from "../online/account.js";
import { RARITY_STARS } from "./GachaCard.js";
import { UnitDetail } from "./UnitDetail.js";
import { CardSlotPicker, slotLabel, type SlotKind } from "./CardSlot.js";

/** 並び順。oldest=入手順（サーバーの並び）、newest=新しい順。 */
export type SortKey = "oldest" | "newest" | "rarity" | "equipped" | "name";
/** カードの装着状態の絞り込み。none=何も付いていない、partial=片方だけ、full=両方付いている。 */
export type EquipFilter = "all" | "none" | "partial" | "full";
export type RarityFilter = "all" | Rarity;

const SORT_LABELS: [SortKey, string][] = [
  ["oldest", "入手順"],
  ["newest", "新しい順"],
  ["rarity", "レア度"],
  ["equipped", "カード装着"],
  ["name", "名前"],
];
const EQUIP_LABELS: [EquipFilter, string][] = [
  ["all", "すべて"],
  ["none", "カードなし"],
  ["partial", "片方だけ"],
  ["full", "両方付き"],
];
const RARITY_FILTERS: RarityFilter[] = ["all", 3, 2, 1];

/** 付いているカードの数（0〜2）。 */
const equippedCount = (u: CharacterUnit) => (u.cardId ? 1 : 0) + (u.cardId2 ? 1 : 0);
const unitName = (u: CharacterUnit) => CHARACTERS[u.characterId]?.name ?? u.characterId;

/** 並び替え。同じ順位の中は、レア度の高い順→名前順で安定させる（入手順は元の並びのまま）。 */
export function sortUnits(units: readonly CharacterUnit[], key: SortKey): CharacterUnit[] {
  const list = [...units];
  if (key === "oldest") return list;
  if (key === "newest") return list.reverse();
  const byRarity = (a: CharacterUnit, b: CharacterUnit) => characterRarity(b.characterId) - characterRarity(a.characterId);
  const byName = (a: CharacterUnit, b: CharacterUnit) => unitName(a).localeCompare(unitName(b), "ja");
  if (key === "rarity") return list.sort((a, b) => byRarity(a, b) || byName(a, b));
  if (key === "equipped") return list.sort((a, b) => equippedCount(b) - equippedCount(a) || byRarity(a, b) || byName(a, b));
  return list.sort((a, b) => byName(a, b) || byRarity(a, b));
}

/** 絞り込み。 */
export function filterUnits(units: readonly CharacterUnit[], rarity: RarityFilter, equip: EquipFilter): CharacterUnit[] {
  return units.filter((u) => {
    if (rarity !== "all" && characterRarity(u.characterId) !== rarity) return false;
    const n = equippedCount(u);
    if (equip === "none") return n === 0;
    if (equip === "partial") return n === 1;
    if (equip === "full") return n === 2;
    return true;
  });
}

/** 最後に選んだ並び順・絞り込みをこのブラウザに覚えておく（読めない・壊れている時は初期値）。 */
const VIEW_KEY = "majyan.units.view";
interface ViewState {
  sort: SortKey;
  rarity: RarityFilter;
  equip: EquipFilter;
}
const DEFAULT_VIEW: ViewState = { sort: "oldest", rarity: "all", equip: "all" };
function loadView(): ViewState {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as Partial<ViewState> | null;
    if (!v) return DEFAULT_VIEW;
    return {
      sort: SORT_LABELS.some(([k]) => k === v.sort) ? (v.sort as SortKey) : DEFAULT_VIEW.sort,
      rarity: RARITY_FILTERS.includes(v.rarity as RarityFilter) ? (v.rarity as RarityFilter) : DEFAULT_VIEW.rarity,
      equip: EQUIP_LABELS.some(([k]) => k === v.equip) ? (v.equip as EquipFilter) : DEFAULT_VIEW.equip,
    };
  } catch {
    return DEFAULT_VIEW;
  }
}
function saveView(v: ViewState) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // 保存できなくても、開いている間は使える。
  }
}

// ===== カードの付け方の練習 =====
// 付けたカードは外せないので、実際の手持ちで試させるわけにはいかない。練習用のキャラとカードを用意して、
// 本物と同じ画面・同じ操作で「キャラを選ぶ→欄を押す→カードを選ぶ→確認→付ける」を体験してもらう
// （本物の手持ち・カードには一切触れない）。今やることは、画面の状態から決める。
type PracticeStage = "list" | "detail" | "pick" | "picked" | "confirm" | "done";

/** 練習用のキャラ3体（ヒイラギを先頭に）と、パッシブ・アクティブのカード各数枚。 */
function makePracticeData(): { units: CharacterUnit[]; cards: Record<string, number> } {
  const ids = ["hiiragi", ...CHARACTER_IDS.filter((id) => id !== "hiiragi")].filter((id) => CHARACTERS[id]).slice(0, 3);
  const units = ids.map((characterId, i) => ({ unitId: `practice-${i}`, characterId, cardId: null, cardId2: null }));
  const pick = (kind: "passive" | "consumable", n: number) => CARD_IDS.filter((id) => CARDS[id]?.kind === kind).slice(0, n);
  const cards = Object.fromEntries([...pick("passive", 4), ...pick("consumable", 3)].map((id) => [id, 1]));
  return { units, cards };
}

const PRACTICE_TEXT: Record<PracticeStage, string> = {
  list: "手持ちのキャラの一覧です（練習用のキャラで、本物の手持ちは変わりません）。光っているキャラを押してみましょう。",
  detail: "キャラの詳細です。必殺技の説明と、カードを付ける欄（パッシブ・アクティブ）が並んでいます。光っている「パッシブカード欄」を押しましょう。",
  pick: "持っているカードのうち、この欄に付けられる種類のカードだけが並びます。カードにカーソルを合わせる（スマホは押す）と、下に効果が出ます。光っているカードを選んでみましょう。",
  picked: "選んだカードの効果が下に出ています。よければ、光っている「付ける」を押しましょう。",
  confirm: "もう一度確認が出ます。本番では、一度付けたカードは外せません。よく選んでから押しましょう（今は練習なので、押しても本物のカードは減りません）。「付ける」を押しましょう。",
  done: "カードが付きました！ パッシブ（青緑）は条件を満たすと自動で効き、アクティブ（紫）は自分の番に押して使います。もう片方の欄も、同じ手順で付けられます。キャラやカードが増えたら、一覧の上の「並び替え・絞り込み」で探せます。",
};

/** 今やることの下にある、光らせる場所（CSSのルールを1つ差し込むだけで、画面の要素には触らない）。 */
const PRACTICE_HIGHLIGHT: Partial<Record<PracticeStage, string>> = {
  list: ".units-screen__grid .units-screen__unit:first-child",
  detail: '.units-screen__detail .cs-slot--btn[data-k="passive"]',
  pick: ".cs-picker__grid .cs-pick:first-child",
  picked: ".cs-picker__actions .btn--primary",
  confirm: ".cs-picker .first-gacha__confirm .btn--primary",
};

function PracticeBanner({ stage, onFinish }: { stage: PracticeStage; onFinish: () => void }) {
  return (
    <div className="practice-banner" role="status">
      <div className="practice-banner__head">カードの付け方（練習）</div>
      <p className="practice-banner__text">{PRACTICE_TEXT[stage]}</p>
      {stage === "done" && (
        <button type="button" className="btn btn--primary practice-banner__finish" onClick={onFinish}>
          練習を終わる
        </button>
      )}
    </div>
  );
}

/**
 * 手持ちのキャラとカード。キャラを押すと必殺技と付けたカードの説明が出る。
 * カードはパッシブ欄・アクティブ欄に1枚ずつ。空の欄を押すと、その欄に付けられる（種類が合う・持っている）
 * カードだけが開く。一度付けたカードは外せないので、付ける前に必ず確認を挟む。
 * キャラが増えても探せるよう、並び替え（入手順・新しい順・レア度・カード装着・名前）と、
 * レア度・カードの装着状態での絞り込みができる（選んだ内容は覚えておく）。
 */
export function UnitsScreen({ onClose, practice = false }: { onClose: () => void; practice?: boolean }) {
  const realUnits = useAccountStore((s) => s.units);
  const realCards = useAccountStore((s) => s.cards);
  const realError = useAccountStore((s) => s.error);
  // 練習の時は、練習用のキャラ・カードを使う（本物の手持ちには触れない）。
  const [demo, setDemo] = useState(makePracticeData);
  const units = practice ? demo.units : realUnits;
  const cards = practice ? demo.cards : realCards;
  const error = practice ? null : realError;
  const [showPractice, setShowPractice] = useState(false);
  const [pickerStage, setPickerStage] = useState<"browse" | "picked" | "confirm">("browse");
  // 選んでいるキャラはIDで持つ（装着のたびにunitsが新しくなっても、最新の中身を読めるように）。
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [openSlot, setOpenSlot] = useState<SlotKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setViewState] = useState<ViewState>(loadView);
  const setView = (patch: Partial<ViewState>) => {
    const next = { ...view, ...patch };
    setViewState(next);
    saveView(next);
  };
  // 表示するキャラ（絞り込んでから並び替える）。装着のたびにunitsが新しくなるので、その都度作り直す。
  const shownUnits = useMemo(() => sortUnits(filterUnits(units, view.rarity, view.equip), view.sort), [units, view]);
  const filtered = view.rarity !== "all" || view.equip !== "all";
  const selectedUnit = units.find((u) => u.unitId === selectedUnitId) ?? null;
  const ownedCardIds = Object.keys(cards);

  function closeDetail() {
    setSelectedUnitId(null);
    setOpenSlot(null);
  }

  async function confirmEquip(cardId: string) {
    if (!selectedUnit) return;
    if (practice) {
      // 練習: 練習用の手持ちだけを書き換える（種類に合う欄に付け、持っている枚数を1枚減らす）。
      const kind = CARDS[cardId]?.kind;
      setDemo((d) => ({
        units: d.units.map((u) => (u.unitId !== selectedUnit.unitId ? u : kind === "passive" ? { ...u, cardId } : { ...u, cardId2: cardId })),
        cards: Object.fromEntries(Object.entries(d.cards).map(([id, n]) => [id, id === cardId ? Math.max(0, n - 1) : n]).filter(([, n]) => (n as number) > 0)),
      }));
      setOpenSlot(null);
      return;
    }
    setBusy(true);
    useAccountStore.setState({ error: null });
    try {
      // 付けられたら欄の選択画面を閉じる（キャラの詳細は開いたまま。付いたカードがそこに出る）。
      if (await equipCard(selectedUnit.unitId, cardId)) setOpenSlot(null);
    } finally {
      setBusy(false);
    }
  }

  // 練習の案内が出す「今やること」。画面の状態から決める。
  const practiceStage: PracticeStage = !selectedUnit
    ? "list"
    : openSlot
      ? pickerStage === "confirm"
        ? "confirm"
        : pickerStage === "picked"
          ? "picked"
          : "pick"
      : selectedUnit.cardId || selectedUnit.cardId2
        ? "done"
        : "detail";
  const practiceBanner = practice ? <PracticeBanner stage={practiceStage} onFinish={onClose} /> : null;
  const practiceHighlight = practice ? PRACTICE_HIGHLIGHT[practiceStage] : undefined;

  return (
    <>
      {practiceHighlight && <style>{`${practiceHighlight} { animation: tutorial-pulse 1s ease-in-out infinite; }`}</style>}
      <div className="modal-overlay" onClick={onClose}>
        <div className="gacha-screen" onClick={(e) => e.stopPropagation()}>
          <div className="setup-picker-modal__header">
            <div className="setup-character-select__label">
              {practice ? "カードの付け方（練習）" : `手持ち（${filtered ? `${shownUnits.length}／${units.length}` : units.length}体）`}
            </div>
            <button type="button" className="setup-picker-modal__close" onClick={onClose}>
              ×
            </button>
          </div>
          {practice ? (
            practiceBanner
          ) : (
            <p className="setup-lead">
              キャラを押すと、パッシブカード欄・アクティブカード欄にカードを付けられます。一度付けたカードは外せません。{" "}
              <button type="button" className="units-screen__chip" onClick={() => setShowPractice(true)}>
                カードの付け方を体験
              </button>
            </p>
          )}
          {error && !selectedUnit && <p className="online-lobby__error">{error}</p>}

          {/* 並び替えと絞り込み。選んだ内容は覚えておく（練習中は出さない）。 */}
          <div className="units-screen__controls" style={practice ? { display: "none" } : undefined}>
            <div className="units-screen__control-row" role="group" aria-label="並び替え">
              <span className="units-screen__control-label">並び替え</span>
              {SORT_LABELS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`units-screen__chip${view.sort === key ? " units-screen__chip--active" : ""}`}
                  onClick={() => setView({ sort: key })}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="units-screen__control-row" role="group" aria-label="レア度で絞り込み">
              <span className="units-screen__control-label">レア度</span>
              {RARITY_FILTERS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`units-screen__chip${view.rarity === r ? " units-screen__chip--active" : ""}`}
                  onClick={() => setView({ rarity: r })}
                >
                  {r === "all" ? "すべて" : RARITY_STARS[r]}
                </button>
              ))}
            </div>
            <div className="units-screen__control-row" role="group" aria-label="カードの装着で絞り込み">
              <span className="units-screen__control-label">カード</span>
              {EQUIP_LABELS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`units-screen__chip${view.equip === key ? " units-screen__chip--active" : ""}`}
                  onClick={() => setView({ equip: key })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="units-screen__grid">
            {shownUnits.map((u) => {
              const character = CHARACTERS[u.characterId];
              const card = u.cardId ? CARDS[u.cardId] : undefined;
              const card2 = u.cardId2 ? CARDS[u.cardId2] : undefined;
              return (
                <button
                  key={u.unitId}
                  type="button"
                  className={`units-screen__unit${selectedUnitId === u.unitId ? " units-screen__unit--selected" : ""}`}
                  onClick={() => {
                    setSelectedUnitId(u.unitId);
                    setOpenSlot(null);
                  }}
                >
                  {character && <img src={character.avatar} alt="" />}
                  <span className="units-screen__stars">{RARITY_STARS[characterRarity(u.characterId)]}</span>
                  <span className="units-screen__name">{character?.name.split("・").at(-1) ?? u.characterId}</span>
                  <span className={`units-screen__card${card ? "" : " units-screen__card--none"}`}>
                    {card ? `${RARITY_STARS[cardRarity(u.cardId!)]} ${card.name}` : "パッシブなし"}
                  </span>
                  <span className={`units-screen__card${card2 ? "" : " units-screen__card--none"}`}>
                    {card2 ? `${RARITY_STARS[cardRarity(u.cardId2!)]} ${card2.name}` : "アクティブなし"}
                  </span>
                </button>
              );
            })}
          </div>

          {units.length > 0 && shownUnits.length === 0 && (
            <p className="setup-lead">
              この条件に合うキャラがいません。{" "}
              <button type="button" className="units-screen__chip" onClick={() => setView({ rarity: "all", equip: "all" })}>
                絞り込みを解除
              </button>
            </p>
          )}

          {ownedCardIds.length === 0 && <p className="setup-lead">付けられるカードを持っていません（カードはガチャで手に入ります）。</p>}
        </div>
      </div>
      {selectedUnit && (
        <div className="modal-overlay" onClick={closeDetail}>
          <div className="gacha-screen units-screen__detail" onClick={(e) => e.stopPropagation()}>
            <div className="setup-picker-modal__header">
              <div className="setup-character-select__label">キャラの詳細</div>
              <button type="button" className="setup-picker-modal__close" onClick={closeDetail}>
                ×
              </button>
            </div>
            {practiceBanner}
            {error && <p className="online-lobby__error">{error}</p>}
            <UnitDetail
              characterId={selectedUnit.characterId}
              cardId={selectedUnit.cardId}
              cardId2={selectedUnit.cardId2}
              onOpenSlot={setOpenSlot}
            />
          </div>
        </div>
      )}
      {selectedUnit && openSlot && (
        <CardSlotPicker
          kind={openSlot}
          title={`${CHARACTERS[selectedUnit.characterId]?.name ?? ""} の${slotLabel(openSlot)}に付けるカード`}
          // この欄に付けられるカード＝持っているカードのうち、この欄の種類のものだけ。
          candidates={ownedCardIds.filter((id) => CARDS[id]?.kind === openSlot)}
          counts={cards}
          permanent
          busy={busy}
          emptyMessage={`付けられる${openSlot === "passive" ? "パッシブ" : "アクティブ"}カードを持っていません（カードはガチャで手に入ります）。`}
          onConfirm={(id) => void confirmEquip(id)}
          onClose={() => setOpenSlot(null)}
          banner={practiceBanner}
          onStage={setPickerStage}
        />
      )}
      {/* カードの付け方の練習（練習用のキャラ・カードで、本物の手持ちには触れない）。 */}
      {!practice && showPractice && <UnitsScreen practice onClose={() => setShowPractice(false)} />}
    </>
  );
}
