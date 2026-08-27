/**
 * 効果音・音声まわり。
 *
 * 打牌/ツモの「音」は実際の牌音源を持っていないため、Web Audio APIで
 * その場で合成した短いクリック音で代用する。
 * 「ポン」「チー」「カン」「ロン」「ツモ」の音声は、収録された本物の
 * 発声データを用意できない（生成もできない）ため、ブラウザ内蔵の
 * SpeechSynthesis（音声合成）で代わりに読み上げる。本物の掛け声には
 * 及ばないが、無音よりは分かりやすくなるはず。
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

/** 「ポン」「チー」「カン」「ロン」「ツモ」等の読み上げ。本物の音声収録の代用。 */
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
