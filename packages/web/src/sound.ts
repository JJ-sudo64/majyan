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
export function playVoiceClip(url: string, gain = 1) {
  const audio = getVoiceClip(url);
  if (!audio) return;
  audio.currentTime = 0;
  audio.volume = getSeVolume() * gain;
  void audio.play().catch(() => {});
}

const DISCARD_SFX = "/sfx/discard.mp3";
const DRAW_SFX = "/sfx/draw.mp3";
const DEAL_SFX = "/sfx/deal.mp3";
const RIICHI_SFX = "/sfx/riichi.mp3";
const WIN_SFX = "/sfx/win.mp3";

/** 打牌・ツモ・配牌のカチッという音はピークが大きくボイスより耳につくので、約-4dB下げて鳴らす。 */
const TILE_SFX_GAIN = 0.6;

/** 打牌音: 牌を卓に置く音。 */
export function playDiscardSound() {
  playVoiceClip(DISCARD_SFX, TILE_SFX_GAIN);
}

/** ツモ音: 牌を引く音。 */
export function playDrawSound() {
  playVoiceClip(DRAW_SFX, TILE_SFX_GAIN);
}

/** 配牌音: 局の開始時に牌を混ぜる音。 */
export function playDealSound() {
  playVoiceClip(DEAL_SFX, TILE_SFX_GAIN);
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

/** 複数の収録ボイスを重ならないよう順番に再生する（役の連続宣言などに使用）。
    onDoneは最後まで再生し終えた時（再生できなかった時も）に1回呼ぶ。 */
export function playVoiceQueue(urls: string[], onDone?: () => void) {
  if (typeof window === "undefined" || urls.length === 0) {
    onDone?.();
    return;
  }
  const [first, ...rest] = urls;
  const audio = getVoiceClip(first!);
  if (!audio) {
    playVoiceQueue(rest, onDone);
    return;
  }
  audio.currentTime = 0;
  audio.volume = getSeVolume();
  audio.onended = () => {
    audio.onended = null;
    playVoiceQueue(rest, onDone);
  };
  void audio.play().catch(() => {
    audio.onended = null;
    playVoiceQueue(rest, onDone);
  });
}

let beepContext: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  beepContext ??= new AudioContext();
  if (beepContext.state === "suspended") void beepContext.resume().catch(() => {});
  return beepContext;
}

const UI_TAP_SFX = "/sfx/ui-tap.mp3";
const UI_CONFIRM_SFX = "/sfx/ui-confirm.mp3";
const UI_CANCEL_SFX = "/sfx/ui-cancel.mp3";
const UI_SUCCESS_SFX = "/sfx/ui-success.mp3";
const sampleCache = new Map<string, Promise<AudioBuffer | null>>();

/** 音源を読み込んで解読しておく（同じURLは1回だけ）。 */
function loadSample(url: string): Promise<AudioBuffer | null> {
  let p = sampleCache.get(url);
  if (!p) {
    const ctx = audioContext();
    p = ctx
      ? fetch(url)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((data) => ctx.decodeAudioData(data))
          .catch(() => {
            sampleCache.delete(url);
            return null;
          })
      : Promise.resolve(null);
    sampleCache.set(url, p);
  }
  return p;
}

export interface SampleHandle {
  /** fadeSec 秒かけて消して止める。 */
  stop(fadeSec?: number): void;
}

/**
 * 音源をWeb Audioで1回鳴らす（同じ音を重ねて鳴らせる）。SE音量に従う。
 * まだ読み込めていなければ読み込み次第鳴らすが、遅れた分は頭を飛ばして演出とずれないようにし、
 * 0.4秒以上遅れたら鳴らさない。
 */
function playSample(url: string): SampleHandle {
  const volume = getSeVolume();
  const ctx = audioContext();
  let stopped = false;
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  if (!ctx || volume <= 0) return { stop() {} };
  const requested = performance.now();
  void loadSample(url).then((buffer) => {
    const late = (performance.now() - requested) / 1000;
    if (!buffer || stopped || late > 0.4) return;
    source = ctx.createBufferSource();
    source.buffer = buffer;
    gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    source.start(0, late > 0.03 ? late : 0);
  });
  return {
    stop(fadeSec = 0.06) {
      stopped = true;
      if (!source || !gain) return;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeSec);
      source.stop(now + fadeSec + 0.02);
    },
  };
}

// メニューのボタン音は小さいので、最初の1回から鳴るよう先に読み込んでおく。
void loadSample(UI_TAP_SFX);
void loadSample(UI_CONFIRM_SFX);
void loadSample(UI_CANCEL_SFX);
void loadSample(UI_SUCCESS_SFX);
void loadSample("/sfx/skill-ready.mp3");

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
 * メニュー画面（選択画面・オンラインのホーム）のボタンを押した時の短い音（public/sfx/ui-*.mp3、scripts/synth-sfx.py）。
 * tap=ふつうのボタン（木を軽く打つ音）、confirm=対局を始める・決定するなどの金色のボタン（琴の2音）、
 * cancel=戻る・閉じるボタン（素材集の「キャンセル」。ui-cancel.mp3）。
 */
export function playUiClick(kind: "tap" | "confirm" | "cancel" = "tap") {
  playSample(kind === "confirm" ? UI_CONFIRM_SFX : kind === "cancel" ? UI_CANCEL_SFX : UI_TAP_SFX);
}

/** 必殺技ゲージが満タンになった時の「ビーム砲チャージ」（自分の席だけ。skill-ready.mp3）。 */
export function playSkillReadySound() {
  playSample("/sfx/skill-ready.mp3");
}

/** 雀玉・プレゼントを受け取れた時の音（素材集の「成功音」）。 */
export function playUiSuccess() {
  playSample(UI_SUCCESS_SFX);
}

/**
 * メニュー画面の一番外側の要素の onClickCapture に渡す。押されたのがボタン・リンクなら音を鳴らす
 * （押せない状態のボタンでは鳴らさない）。
 */
export function playUiClickFor(event: { target: EventTarget | null }) {
  const target = event.target instanceof Element ? event.target.closest("button, a, select") : null;
  if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
  const isCancel = target.matches(".oh-back, .setup-picker-modal__close, .pv-modal__close");
  playUiClick(isCancel ? "cancel" : target.matches(".oh-mode, .oh-cta, .btn--primary") ? "confirm" : "tap");
}

/**
 * ガチャの演出（GachaReveal.tsx）の音（public/sfx/gacha-*.mp3、scripts/synth-sfx.py で合成した音源）。
 * charge=光の玉が溜まる間のせり上がる音（tierはその回の一番高いレア度で、溜めの長さも違う。
 * はじける時に止めるので、止め方を返す）、upgrade=玉の色が青・金に上がった時、
 * burst=はじけた時（tierで規模が違う）、rare=★3を見せる時のファンファーレ。
 */
export function playGachaSound(kind: "charge" | "upgrade" | "burst", tier: 1 | 2 | 3): SampleHandle;
export function playGachaSound(kind: "rare"): SampleHandle;
export function playGachaSound(kind: "charge" | "upgrade" | "burst" | "rare", tier: 1 | 2 | 3 = 3): SampleHandle {
  return playSample(kind === "rare" ? "/sfx/gacha-rare.mp3" : `/sfx/gacha-${kind}-${tier}.mp3`);
}

/** ガチャの音を先に読み込んでおく（ガチャ画面を開いた時に呼ぶ。最初の1回が遅れて鳴らないように）。 */
export function preloadGachaSounds() {
  for (const tier of [1, 2, 3]) {
    void loadSample(`/sfx/gacha-charge-${tier}.mp3`);
    void loadSample(`/sfx/gacha-burst-${tier}.mp3`);
    if (tier > 1) void loadSample(`/sfx/gacha-upgrade-${tier}.mp3`);
  }
  void loadSample("/sfx/gacha-rare.mp3");
}
