import { CARDS, CHARACTERS, TUTORIAL_SCENARIOS } from "@majyan/core";

/**
 * キャラクター・必殺技・カードの名前と説明は、coreに日本語で書いてある（サーバーと共有のため）。
 * 他の言語では、日本語の原文をキーにした対訳表（data辞書）で、表示の直前に差し替える。
 * 対訳が無い文言は日本語のまま出る。差し替えは、coreの定義オブジェクトの文字欄を書き換える形で行うので、
 * 呼び出し側（画面）は何も変えなくてよい。原文は最初に控えておき、日本語に戻す時もそこから戻す。
 */
interface Original {
  target: Record<string, unknown>;
  field: string;
  text: string;
}

let originals: Original[] | null = null;

function collect(): Original[] {
  const list: Original[] = [];
  const add = (target: object, field: string) => {
    const text = (target as Record<string, unknown>)[field];
    if (typeof text === "string" && text) list.push({ target: target as Record<string, unknown>, field, text });
  };
  for (const c of Object.values(CHARACTERS)) {
    add(c, "name");
    add(c, "description");
    add(c, "winQuote");
    add(c.skill, "name");
    add(c.skill, "description");
    add(c.skill, "activationCondition");
  }
  for (const card of Object.values(CARDS)) {
    add(card, "name");
    add(card, "description");
  }
  return list;
}

/** coreの役判定・点数計算が日本語で出す名前（画面では tx() で直す）。 */
export const CORE_TEXTS: string[] = [
  "役満","ダブル役満","トリプル役満","三倍満","倍満","跳満","満貫",
  "立直","ダブル立直","一発","門前清自摸和","海底摸月","河底撈魚","嶺上開花","槍槓","平和","断幺九","自風牌","場風牌","役牌",
  "一盃口","二盃口","三色同順","三色同刻","一気通貫","混老頭","純全帯幺九","混全帯幺九","対々和","三槓子","三暗刻","小三元","混一色","清一色",
  "七対子","狙い撃ち","オープンリーチ","裏ドラ","赤ドラ","ドラ","カード効果",
  "当たり牌のロンを防いだ","テンパイ扱いになった","フリテンでもロンできる","役牌を鳴かせなかった","一発が続く","リーチ棒を払わずに済んだ","持ち点が0点で止まった",
  "カードを使った","山に待ち牌がありません","山に手が良くなる牌がありません","山にドラがありません","山に当たり牌以外が残っていません","山に有効牌がありません",
  "陰陽配牌","親なので、3枚の組が無い配牌にした","親ではないので、3枚の組を作った","一閃","手ほどき","特技ドラ引き","手牌が一枚しかない人","太っ腹",
  "下雀","中雀","上雀","雀王","雀帝","雀神",
  "段位戦を1回打つ","段位戦で2位以上に入る","段位戦を3回打つ","段位戦を10回打つ","段位戦で2位以上に5回入る","段位戦で1位になる（2回）",
  "国士無双","九蓮宝燈","四暗刻","大三元","小四喜","大四喜","字一色","緑一色","清老頭","四槓子","天和","地和",
];

/** 翻訳が要る日本語の原文の一覧（対訳表を作る時の元）。 */
export function dataSourceTexts(): string[] {
  originals ??= collect();
  const tutorial = TUTORIAL_SCENARIOS.flatMap((s) => s.steps.map((st) => st.text));
  return [...new Set([...originals.map((o) => o.text), ...CORE_TEXTS, ...tutorial])];
}

/** 対訳表に従って、キャラクターとカードの文言を差し替える（表が無ければ日本語に戻す）。 */
export function applyDataLocale(table: Record<string, string> | undefined): void {
  originals ??= collect();
  for (const o of originals) o.target[o.field] = table?.[o.text] ?? o.text;
}
