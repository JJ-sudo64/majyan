/**
 * 効果音・音声まわり。
 *
 * 打牌/ツモの「音」は実際の牌音源を持っていないため、Web Audio APIで
 * その場で合成した短いクリック音で代用する。
 * 「ポン」「チー」「カン」「ロン」「ツモ」等の音声は、キャラクターごとに
 * 収録ボイス（Character.voiceClips）が用意されていればそれを再生し、
 * 未収録のキャラ/イベントはブラウザ内蔵のSpeechSynthesis（音声合成）で
 * 代わりに読み上げる。
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function playClick(freq: number, duration: number, type: OscillatorType, gain: number) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

/** 打牌音: 牌を卓に打ち付ける短く硬いクリック。 */
export function playDiscardSound() {
  playClick(1400, 0.05, "square", 0.1);
}

/** ツモ音: 牌を引く少し低めで柔らかいクリック。 */
export function playDrawSound() {
  playClick(650, 0.07, "triangle", 0.08);
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
  void audio.play().catch(() => {});
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
  audio.onended = () => {
    audio.onended = null;
    if (rest.length > 0) playVoiceQueue(rest);
  };
  void audio.play().catch(() => {
    audio.onended = null;
    if (rest.length > 0) playVoiceQueue(rest);
  });
}
