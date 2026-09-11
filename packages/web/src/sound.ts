/**
 * 効果音・音声まわり。
 *
 * 打牌・ツモ・配牌・リーチ棒の効果音は収録された実音源（public/sfx/配下）を
 * 再生する。「ポン」「チー」「カン」「ロン」「ツモ」等の掛け声は、
 * キャラクターごとに収録ボイス（Character.voiceClips）が用意されていれば
 * それを再生し、未収録のキャラ/イベントはブラウザ内蔵のSpeechSynthesis
 * （音声合成）で代わりに読み上げる。どちらも設定パネルのSE音量
 * （useSettingsStore.seVolume、BGM音量とは独立）に従う。
 */
import { useSettingsStore } from "./store/settingsStore.js";

function getSeVolume(): number {
  return useSettingsStore.getState().seVolume;
}

function getJapaneseVoice(): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !window.speechSynthesis) return undefined;
  return window.speechSynthesis.getVoices().find((v) => v.lang?.startsWith("ja"));
}

/** 「ポン」「チー」「カン」「ロン」「ツモ」等の読み上げ。収録ボイスが無い場合の代用。 */
export function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ja-JP";
  utter.rate = 1.05;
  utter.pitch = 1.05;
  utter.volume = getSeVolume();
  const voice = getJapaneseVoice();
  if (voice) utter.voice = voice;
  window.speechSynthesis.speak(utter);
}

const voiceClipCache = new Map<string, HTMLAudioElement>();

function getVoiceClip(url: string): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  let audio = voiceClipCache.get(url);
  if (!audio) {
    audio = new Audio(url);
    voiceClipCache.set(url, audio);
  }
  return audio;
}

/** 収録ボイス音源を1つ再生する（TTSへのフォールバックなし）。 */
export function playVoiceClip(url: string) {
  const audio = getVoiceClip(url);
  if (!audio) return;
  audio.currentTime = 0;
  audio.volume = getSeVolume();
  void audio.play().catch(() => {});
}

const DISCARD_SFX = "/sfx/discard.mp3";
const DRAW_SFX = "/sfx/draw.mp3";
const DEAL_SFX = "/sfx/deal.mp3";
const RIICHI_STICK_SFX = "/sfx/riichi-stick.mp3";

/** 打牌音: 牌を卓に置く音。 */
export function playDiscardSound() {
  playVoiceClip(DISCARD_SFX);
}

/** ツモ音: 牌を引く音。 */
export function playDrawSound() {
  playVoiceClip(DRAW_SFX);
}

/** 配牌音: 局の開始時に牌を混ぜる音。 */
export function playDealSound() {
  playVoiceClip(DEAL_SFX);
}

/** リーチ宣言時、点棒（1000点棒）を卓に置く音。 */
export function playRiichiStickSound() {
  playVoiceClip(RIICHI_STICK_SFX);
}

/** 収録ボイスがあればそれを再生し、無ければfallbackTextをspeak()で読み上げる。 */
export function speakVoice(clipUrl: string | undefined, fallbackText: string) {
  if (clipUrl) {
    playVoiceClip(clipUrl);
    return;
  }
  speak(fallbackText);
}

/** 複数の収録ボイスを重ならないよう順番に再生する（役の連続宣言などに使用）。 */
export function playVoiceQueue(urls: string[]) {
  if (typeof window === "undefined" || urls.length === 0) return;
  const [first, ...rest] = urls;
  const audio = getVoiceClip(first!);
  if (!audio) return;
  audio.currentTime = 0;
  audio.volume = getSeVolume();
  audio.onended = () => {
    audio.onended = null;
    if (rest.length > 0) playVoiceQueue(rest);
  };
  void audio.play().catch(() => {
    audio.onended = null;
    if (rest.length > 0) playVoiceQueue(rest);
  });
}
