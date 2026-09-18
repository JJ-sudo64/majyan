import { useEffect, useRef } from "react";
import { useSettingsStore } from "../store/settingsStore.js";

const TITLE_BGM_SRC = "/bgm/taiga.mp3";

/**
 * タイトル画面からキャラクター選択画面（対局開始前）まで流すBGM。
 * enabledがfalseになる（＝対局が始まりTable.tsx側のuseBgmに切り替わる）と
 * 自然に止まる。ブラウザの自動再生制限で最初のplay()がブロックされた
 * 場合は、ユーザーが画面のどこかを最初にクリックした瞬間に1回だけ再試行する。
 */
export function useTitleBgm(enabled: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bgmVolume = useSettingsStore((s) => s.bgmVolume);

  useEffect(() => {
    if (!enabled) return undefined;

    const audio = new Audio(TITLE_BGM_SRC);
    audio.loop = true;
    audio.volume = useSettingsStore.getState().bgmVolume;
    audioRef.current = audio;
    audio.play().catch(() => {});

    function retryOnInteraction() {
      audio.play().catch(() => {});
    }
    window.addEventListener("pointerdown", retryOnInteraction, { once: true });

    return () => {
      window.removeEventListener("pointerdown", retryOnInteraction);
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = bgmVolume;
  }, [bgmVolume]);
}
