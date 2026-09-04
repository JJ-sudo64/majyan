import { useEffect, useRef } from "react";
import { CHARACTERS, type Meld, type RoundState } from "@majyan/core";
import { playDiscardSound, playDrawSound, speak } from "../sound.js";

const CALL_VOICE: Partial<Record<Meld["type"], string>> = {
  chi: "チー",
  pon: "ポン",
  minkan: "カン",
  kakan: "カン",
  ankan: "カン",
};

/**
 * 打牌・ツモ・鳴き・和了に合わせて効果音/読み上げを鳴らす。
 * 4人分をまとめてここで一元管理する（人間・敵のどちらの操作でも同じ音を出す）。
 * 対局が始まっていない間（round未定義）は何もしない。
 */
export function useGameSounds(round: RoundState | undefined) {
  const totalDiscards = round?.players.reduce((sum, p) => sum + p.discards.length, 0) ?? 0;
  const prevDiscardsRef = useRef(totalDiscards);
  useEffect(() => {
    if (totalDiscards > prevDiscardsRef.current) playDiscardSound();
    prevDiscardsRef.current = totalDiscards;
  }, [totalDiscards]);

  const drawnTileId = round?.lastDrawnTile?.id;
  const prevDrawnIdRef = useRef(drawnTileId);
  useEffect(() => {
    if (drawnTileId && drawnTileId !== prevDrawnIdRef.current) playDrawSound();
    prevDrawnIdRef.current = drawnTileId;
  }, [drawnTileId]);

  // 加槓（kakan）は新しい副露を追加するのではなく、既存のポンをその場で
  // カンへ差し替える（配列の長さは変わらない）ため、単純な枚数比較では
  // 検出できなかった。各プレイヤーの副露「種類の並び」を文字列化して
  // 比較し、枚数が増えた（新規の副露）場合と、同じ枚数のまま途中の種類が
  // 変わった（加槓による差し替え）場合の両方を拾う。
  const meldTypesByPlayer = round?.players.map((p) => p.hand.melds.map((m) => m.type)) ?? [[], [], [], []];
  const meldsSignature = meldTypesByPlayer.map((types) => types.join(",")).join("|");
  const prevMeldTypesRef = useRef(meldTypesByPlayer);
  useEffect(() => {
    const prev = prevMeldTypesRef.current;
    for (let i = 0; i < meldTypesByPlayer.length; i++) {
      const curTypes = meldTypesByPlayer[i]!;
      const prevTypes = prev[i] ?? [];
      if (curTypes.length > prevTypes.length) {
        const label = CALL_VOICE[curTypes[curTypes.length - 1]!];
        if (label) speak(label);
      } else if (curTypes.length === prevTypes.length) {
        for (let j = 0; j < curTypes.length; j++) {
          if (curTypes[j] !== prevTypes[j]) {
            const label = CALL_VOICE[curTypes[j]!];
            if (label) speak(label);
            break;
          }
        }
      }
    }
    prevMeldTypesRef.current = meldTypesByPlayer;
  }, [meldsSignature]);

  // リーチ宣言（player.riichiがfalse→trueに変わった瞬間）で発声する。
  const riichiFlags = round?.players.map((p) => p.riichi) ?? [false, false, false, false];
  const riichiSignature = riichiFlags.join(",");
  const prevRiichiFlagsRef = useRef(riichiFlags);
  useEffect(() => {
    const prev = prevRiichiFlagsRef.current;
    if (riichiFlags.some((r, i) => r && !prev[i])) speak("リーチ");
    prevRiichiFlagsRef.current = riichiFlags;
  }, [riichiSignature]);

  // 必殺技発動（skillGaugeが満タンから0に戻った瞬間）で、キャラ名+技名を読み上げる。
  // ゲージは通常の加算では減らないため、0への低下＝発動とみなせる。
  const skillGauges = round?.players.map((p) => p.skillGauge) ?? [0, 0, 0, 0];
  const skillGaugeSignature = skillGauges.join(",");
  const prevSkillGaugesRef = useRef(skillGauges);
  useEffect(() => {
    const prev = prevSkillGaugesRef.current;
    if (round) {
      for (let i = 0; i < skillGauges.length; i++) {
        if (prev[i]! > 0 && skillGauges[i] === 0) {
          const character = CHARACTERS[round.characterIds[i]!];
          if (character) speak(`${character.voiceName ?? character.name} ${character.skill.voiceName ?? character.skill.name}`);
        }
      }
    }
    prevSkillGaugesRef.current = skillGauges;
  }, [skillGaugeSignature]);

  const phase = round?.phase;
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    if (phase === "round-over" && prevPhaseRef.current !== "round-over") {
      const result = round?.result;
      if (result?.type === "tsumo") speak("ツモ");
      else if (result?.type === "ron") speak("ロン");
    }
    prevPhaseRef.current = phase;
  }, [phase, round?.result]);
}
