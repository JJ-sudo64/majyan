const STAMP_IDS = ["hello", "thanks", "nice", "wow", "hmm", "ouch", "sorry", "gg"];

/** キャラごとのスタンプ絵（スタンプのidから画像）。無いスタンプ・無いキャラは文字の吹き出しで出す。 */
const STAMP_ART_CHARACTERS = ["hiiragi", "nagi", "raiko", "toki", "kagerou", "runa", "subaru", "kaede", "jin", "ren", "masato", "mirai", "saki", "naoki", "tomohiro", "koki", "takaharu", "nyanjiro", "mebius", "koji", "nannan", "deagari", "zeno", "kagami", "karin", "sena", "mio"];

export function stampArt(characterId: string | undefined, stampId: string): string | undefined {
  if (!characterId || !STAMP_ART_CHARACTERS.includes(characterId) || !STAMP_IDS.includes(stampId)) return undefined;
  return `/stamps/${characterId}-${stampId}.webp`;
}
