/** シェア先は公式ページ（OGP・検索の入口）。ゲーム本体はnoindexなのでこちらを渡す。 */
export const SHARE_URL = "https://janhai.maxplantlabs.com/";
export const SHARE_HASHTAGS = ["雀杯", "異能麻雀"];

/** Xの投稿画面を新しいタブで開く（アカウント連携は不要。投稿は本人が押すまで行われない）。 */
export function shareToX(text: string): void {
  const params = new URLSearchParams({ text, url: SHARE_URL, hashtags: SHARE_HASHTAGS.join(",") });
  window.open(`https://twitter.com/intent/tweet?${params.toString()}`, "_blank", "noopener,noreferrer");
}
