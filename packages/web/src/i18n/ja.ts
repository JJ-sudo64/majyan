/**
 * 日本語の文言一覧（原本）。キーを足すときはここに日本語を書き、他の言語は同じキーで訳す。
 * 他の言語に無いキーは、日本語にフォールバックして表示される（画面が空になることはない）。
 * 命名: 「画面.要素」。値の中の {name} は t(key, { name }) で差し込む。
 */
export const ja = {
  "title.play": "プレイ",
  "title.rules": "ルール",
  "title.settings": "設定",
  "title.exit": "終了",
  "title.exitConfirm": "雀杯を終了しますか？",
  "title.logoAlt": "雀杯",
  "common.close": "閉じる",
  "settings.title": "設定",
  "settings.bgmVolume": "BGM音量",
  "settings.seVolume": "SE音量",
  "settings.volume": "音量設定",
  "settings.auto": "自動",
  "settings.autoTsumogiri": "ツモ切り",
  "settings.autoTsumogiriHint": "自動ツモ切り：引いた牌を自動で切る",
  "settings.autoWin": "和了",
  "settings.autoWinHint": "自動和了：和了できる時に自動で和了する",
  "settings.autoPassCalls": "鳴きなし",
  "settings.autoPassCallsHint": "鳴きなし：ポン・チー・カンを自動で見送る",
  "settings.tile3d": "立体牌",
  "settings.on": "ON",
  "settings.off": "OFF",
  "settings.language": "言語",
} as const;

export type MessageKey = keyof typeof ja;
