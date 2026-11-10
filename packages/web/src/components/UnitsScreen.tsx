import { useMemo, useState } from "react";
import { CARDS, CHARACTERS, cardRarity, characterRarity, type CharacterUnit, type Rarity } from "@majyan/core";
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

/**
 * 手持ちのキャラとカード。キャラを押すと必殺技と付けたカードの説明が出る。
 * カードはパッシブ欄・アクティブ欄に1枚ずつ。空の欄を押すと、その欄に付けられる（種類が合う・持っている）
 * カードだけが開く。一度付けたカードは外せないので、付ける前に必ず確認を挟む。
 * キャラが増えても探せるよう、並び替え（入手順・新しい順・レア度・カード装着・名前）と、
 * レア度・カードの装着状態での絞り込みができる（選んだ内容は覚えておく）。
 */
export function UnitsScreen({ onClose }: { onClose: () => void }) {
  const units = useAccountStore((s) => s.units);
  const cards = useAccountStore((s) => s.cards);
  const error = useAccountStore((s) => s.error);
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
    setBusy(true);
    useAccountStore.setState({ error: null });
    try {
      // 付けられたら欄の選択画面を閉じる（キャラの詳細は開いたまま。付いたカードがそこに出る）。
      if (await equipCard(selectedUnit.unitId, cardId)) setOpenSlot(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="gacha-screen" onClick={(e) => e.stopPropagation()}>
          <div className="setup-picker-modal__header">
            <div className="setup-character-select__label">
              手持ち（{filtered ? `${shownUnits.length}／${units.length}` : units.length}体）
            </div>
            <button type="button" className="setup-picker-modal__close" onClick={onClose}>
              ×
            </button>
          </div>
          <p className="setup-lead">キャラを押すと、パッシブカード欄・アクティブカード欄にカードを付けられます。一度付けたカードは外せません。</p>
          {error && !selectedUnit && <p className="online-lobby__error">{error}</p>}

          {/* 並び替えと絞り込み。選んだ内容は覚えておく。 */}
          <div className="units-screen__controls">
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
        />
      )}
    </>
  );
}
