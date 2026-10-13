/**
 * 効果音・音声まわり。
 *
 * 打牌・ツモ・配牌・リーチ・和了の効果音は収録された実音源（public/sfx/配下）を
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
const RIICHI_SFX = "/sfx/riichi.mp3";
const WIN_SFX = "/sfx/win.mp3";

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

/** リーチ宣言の効果音（「シャキーン」。以前は点棒を卓に置く音だった）。 */
export function playRiichiSound() {
  playVoiceClip(RIICHI_SFX);
}

/** ロン・ツモ（和了）の効果音（「文字表示の衝撃音」）。 */
export function playWinSound() {
  playVoiceClip(WIN_SFX);
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

let beepContext: AudioContext | null = null;

/**
 * 制限時間の残り数秒を知らせる短い電子音（音源ファイルを使わずWeb Audioで鳴らす）。
 * lastなら最後の1秒用に高く長めの音にする。SE音量に従う。
 */
export function playCountdownBeep(last = false) {
  if (typeof window === "undefined" || !window.AudioContext) return;
  const volume = getSeVolume();
  if (volume <= 0) return;
  beepContext ??= new AudioContext();
  const ctx = beepContext;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  const start = ctx.currentTime;
  const length = last ? 0.35 : 0.12;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = last ? 1320 : 880;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.35 * volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/**
 * メニュー画面（選択画面・オンラインのホーム）のボタンを押した時の短い音。
 * 音源ファイルを使わずWeb Audioで鳴らす。SE音量に従う。
 * tap=ふつうのボタン、confirm=対局を始める・決定するなどの金色のボタン。
 */
export function playUiClick(kind: "tap" | "confirm" = "tap") {
  if (typeof window === "undefined" || !window.AudioContext) return;
  const volume = getSeVolume();
  if (volume <= 0) return;
  beepContext ??= new AudioContext();
  const ctx = beepContext;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  const start = ctx.currentTime;
  // [開始の遅れ, 始まりの高さ, 終わりの高さ, 長さ, 大きさ]
  const notes: [number, number, number, number, number][] =
    kind === "confirm"
      ? [
          [0, 784, 784, 0.16, 0.16],
          [0.07, 1175, 1175, 0.26, 0.14],
        ]
      : [[0, 660, 440, 0.07, 0.12]];
  for (const [delay, from, to, length, level] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(from, start + delay);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, start + delay + length);
    gain.gain.setValueAtTime(0.0001, start + delay);
    gain.gain.exponentialRampToValueAtTime(level * volume, start + delay + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + delay);
    osc.stop(start + delay + length + 0.02);
  }
}

/**
 * メニュー画面の一番外側の要素の onClickCapture に渡す。押されたのがボタン・リンクなら音を鳴らす
 * （押せない状態のボタンでは鳴らさない）。
 */
export function playUiClickFor(event: { target: EventTarget | null }) {
  const target = event.target instanceof Element ? event.target.closest("button, a, select") : null;
  if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
  playUiClick(target.matches(".oh-mode, .oh-cta, .btn--primary") ? "confirm" : "tap");
}

/**
 * ガチャの演出（GachaReveal.tsx）の音。音源ファイルを使わずWeb Audioで鳴らす。SE音量に従う。
 * charge=光の玉が溜まる間のせり上がる音（secondsはその長さ）、upgrade=玉の色が上がった時、
 * burst=はじけた時、rare=★3を見せる時のファンファーレ。
 */
export function playGachaSound(kind: "charge" | "upgrade" | "burst" | "rare", seconds = 1.5) {
  if (typeof window === "undefined" || !window.AudioContext) return;
  const volume = getSeVolume();
  if (volume <= 0) return;
  beepContext ??= new AudioContext();
  const ctx = beepContext;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  const start = ctx.currentTime;
  // [波形, 開始の遅れ, 始まりの高さ, 終わりの高さ, 長さ, 大きさ, 立ち上がりの長さ]
  type Note = [OscillatorType, number, number, number, number, number, number];
  const notes: Note[] =
    kind === "charge"
      ? [
          ["sawtooth", 0, 70, 280, seconds, 0.05, seconds * 0.9],
          ["sine", 0, 220, 1320, seconds, 0.08, seconds * 0.9],
        ]
      : kind === "upgrade"
        ? [
            ["triangle", 0, 988, 988, 0.22, 0.14, 0.01],
            ["triangle", 0.06, 1480, 1480, 0.3, 0.12, 0.01],
          ]
        : kind === "burst"
          ? [
              ["sine", 0, 160, 40, 0.5, 0.4, 0.01],
              ["triangle", 0, 523, 523, 0.9, 0.12, 0.01],
              ["triangle", 0, 784, 784, 0.9, 0.1, 0.01],
              ["triangle", 0, 1047, 1047, 1.1, 0.1, 0.01],
              ["sine", 0, 2093, 3136, 0.5, 0.05, 0.01],
            ]
          : [
              ["triangle", 0, 523, 523, 0.3, 0.14, 0.01],
              ["triangle", 0.1, 659, 659, 0.3, 0.14, 0.01],
              ["triangle", 0.2, 784, 784, 0.3, 0.14, 0.01],
              ["triangle", 0.3, 1047, 1047, 0.9, 0.16, 0.01],
              ["triangle", 0.3, 1319, 1319, 0.9, 0.1, 0.01],
              ["sine", 0.3, 1568, 1568, 1.2, 0.08, 0.01],
            ];
  for (const [type, delay, from, to, length, level, attack] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start + delay);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, start + delay + length);
    gain.gain.setValueAtTime(0.0001, start + delay);
    gain.gain.exponentialRampToValueAtTime(level * volume, start + delay + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + delay);
    osc.stop(start + delay + length + 0.02);
  }
}
