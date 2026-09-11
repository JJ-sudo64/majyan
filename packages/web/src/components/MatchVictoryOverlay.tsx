import { useEffect } from "react";
import type { Character, PlayerIndex } from "@majyan/core";
import { playVoiceClip } from "../sound.js";

const PLAYER_NAMES: Record<number, string> = { 0: "あなた", 1: "下家", 2: "対面", 3: "上家" };

/**
 * 対局終了後、結果モーダル（役・点数内訳、順位一覧）を確認し終えた後に見せる
 * 専用の優勝演出。狭い結果モーダルの中に埋め込むと他の情報に埋もれて
 * 目立たなかった（「全然出てない」との指摘）ため、モーダルとは別の
 * 画面いっぱいを使うオーバーレイとして独立させている。
 */
export function MatchVictoryOverlay({
  champion,
  onBackToTitle,
}: {
  champion: { player: PlayerIndex; character: Character };
  onBackToTitle: () => void;
}) {
  // 収録ボイスがあるキャラのみ、演出表示と同時に勝利台詞を読み上げる
  // （TTSフォールバックは行わない。棒読みで長台詞を読ませるのは
  //   逆に演出を損なうため）。
  useEffect(() => {
    const clip = champion.character.voiceClips?.winQuote;
    if (clip) playVoiceClip(clip);
  }, [champion.character]);

  return (
    <div className="modal-overlay match-victory-overlay">
      <div className="match-victory-card">
        <div className="match-victory-card__panel" />
        <div className="match-victory-card__title">優勝</div>
        <img className="match-victory-card__art" src={champion.character.cutin ?? champion.character.avatar} alt="" />
        <div className="match-victory-card__name">
          {PLAYER_NAMES[champion.player]}（{champion.character.name}）
        </div>
        <div className="match-victory-card__quote">「{champion.character.winQuote}」</div>
        <button className="btn btn--primary btn--large" onClick={onBackToTitle}>
          タイトルへ戻る
        </button>
      </div>
    </div>
  );
}
