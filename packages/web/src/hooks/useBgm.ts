import { useEffect, useRef } from "react";
import type { RoundState } from "@majyan/core";
import { useSettingsStore } from "../store/settingsStore.js";

const NORMAL_BGM_SRC = "/bgm/wafu-sakuya3.mp3";
/** 誰か1人でもリーチしている間だけ、こちらの緊迫感のあるBGMに切り替える。 */
const RIICHI_BGM_SRC = "/bgm/wafu-battle.mp3";

/**
 * 対局中のBGMをループ再生する。Table.tsxがマウントされている間（＝対局画面を
 * 表示している間）だけ鳴らし、タイトルへ戻る（Tableがアンマウントされる）と
 * 自然に止まる。誰かがリーチすると緊迫感のあるBGMに切り替わり、次局が
 * 配牌されてリーチが誰も残っていない状態に戻ると通常BGMに戻る。
 * 局が終わった瞬間（ツモ・ロンに加え、荒牌平局・九種九牌等の流局も含む）は
 * BGMを止め、次局の配牌と同時に自然に再開する。
 * ブラウザの自動再生制限で最初のplay()がブロックされた場合は、ユーザーが
 * 画面のどこかを最初にクリックした瞬間に1回だけ再試行する。
 */
export function useBgm(round: RoundState | undefined) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bgmVolume = useSettingsStore((s) => s.bgmVolume);

  useEffect(() => {
    const audio = new Audio();
    audio.loop = true;
    audio.volume = useSettingsStore.getState().bgmVolume;
    audioRef.current = audio;

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
  }, []);

  // 音量スライダーの操作を、対局中いつでも即座に反映する。
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = bgmVolume;
  }, [bgmVolume]);

  const anyRiichi = round?.players.some((p) => p.riichi) ?? false;
  // 局終了画面（ツモ・ロンに加え、荒牌平局・九種九牌等の流局も含む）では
  // 結果を確認している間、BGMを止める。次局の配牌と同時に自然に再開する。
  const roundOver = round?.phase === "round-over";
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !round) return;
    if (roundOver) {
      audio.pause();
      return;
    }
    const nextSrc = anyRiichi ? RIICHI_BGM_SRC : NORMAL_BGM_SRC;
    // 絶対パスに解決された値と比較するため、srcではなくpathnameで見る。
    if (!audio.src || new URL(audio.src).pathname !== nextSrc) {
      audio.src = nextSrc;
    }
    audio.play().catch(() => {});
  }, [anyRiichi, roundOver, round]);
}
