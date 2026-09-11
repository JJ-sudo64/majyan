import { useEffect, useRef } from "react";
import { CHARACTERS, type Meld, type RoundState, type VoiceEvent } from "@majyan/core";
import { playDiscardSound, playDrawSound, playVoiceClip, speakVoice } from "../sound.js";

const CALL_VOICE: Partial<Record<Meld["type"], string>> = {
  chi: "チー",
  pon: "ポン",
  minkan: "カン",
  kakan: "カン",
  ankan: "カン",
};

const CALL_EVENT: Partial<Record<Meld["type"], VoiceEvent>> = {
  chi: "chi",
  pon: "pon",
  minkan: "kan",
  kakan: "kan",
  ankan: "kan",
};

/** playerの鳴き/リーチ/ツモ/ロンを、キャラの収録ボイス（無ければTTS）で読み上げる。 */
function speakPlayerVoice(round: RoundState | undefined, player: number, event: VoiceEvent, fallbackText: string) {
  const character = round ? CHARACTERS[round.characterIds[player]!] : undefined;
  speakVoice(character?.voiceClips?.[event], fallbackText);
}

/**
 * 打牌・ツモ・鳴き・和了に合わせて効果音/読み上げを鳴らす。
 * 4人分をまとめてここで一元管理する（人間・敵のどちらの操作でも同じ音を出す）。
 * 対局が始まっていない間（round未定義）は何もしない。
 */
export function useGameSounds(round: RoundState | undefined) {
  // 対局開始（roundがundefined→定義済みに変わった瞬間）に、挨拶ボイスを
  // 持つキャラがいれば1回だけ再生する。局が進む間はroundが常に定義済みの
  // ままなので、次に発火するのはタイトルへ戻って新しい対局を始めた時のみ。
  const roundStarted = !!round;
  const hadRoundRef = useRef(false);
  useEffect(() => {
    if (!hadRoundRef.current && round) {
      for (const characterId of round.characterIds) {
        const clip = CHARACTERS[characterId]?.voiceClips?.greeting;
        if (clip) {
          playVoiceClip(clip);
          break;
        }
      }
    }
    hadRoundRef.current = roundStarted;
  }, [roundStarted]);

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
        const type = curTypes[curTypes.length - 1]!;
        const label = CALL_VOICE[type];
        if (label) speakPlayerVoice(round, i, CALL_EVENT[type]!, label);
      } else if (curTypes.length === prevTypes.length) {
        for (let j = 0; j < curTypes.length; j++) {
          if (curTypes[j] !== prevTypes[j]) {
            const type = curTypes[j]!;
            const label = CALL_VOICE[type];
            if (label) speakPlayerVoice(round, i, CALL_EVENT[type]!, label);
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
    const declaredIndex = riichiFlags.findIndex((r, i) => r && !prev[i]);
    if (declaredIndex !== -1) speakPlayerVoice(round, declaredIndex, "riichi", "リーチ");
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
          if (character) {
            const fallback = `${character.voiceName ?? character.name} ${character.skill.voiceName ?? character.skill.name}`;
            speakVoice(character.voiceClips?.skillActivate, fallback);
          }
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
      if (result?.type === "tsumo") speakPlayerVoice(round, result.winners[0]!, "tsumo", "ツモ");
      else if (result?.type === "ron") speakPlayerVoice(round, result.winners[0]!, "ron", "ロン");
    }
    prevPhaseRef.current = phase;
  }, [phase, round?.result]);
}
