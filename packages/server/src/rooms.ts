/**
 * 合言葉の部屋（友人戦）の管理。通信手段（WebSocket）には依存せず、
 * 接続をClientとして受け取る（index.tsがWebSocketとつなぐ）。
 *
 * - 同じ合言葉で入った人が同じ部屋に集まる（最大4人）。最初に入った人が部屋主
 * - 部屋主が開始すると、集まった人をランダムな席に座らせ、空いた席はCPUが入る
 * - 入るにはアカウント（accounts.ts）のログイン用の鍵が要る。名前はアカウントの表示名
 * - 対局中に接続が切れた人は、同じアカウントで入り直すとその席に戻れる
 * - 人間が全員いなくなった部屋は、しばらく誰も戻らなければ片付ける
 */
import {
  createMatch,
  randomCardId,
  randomCharacterIds,
  CARDS,
  CHARACTERS,
  DEFAULT_AI_DIFFICULTY,
  ROOM_CODE_MAX_LENGTH,
  type AccountProfile,
  type ClientMessage,
  type LobbyMember,
  type MatchState,
  type MatchFormat,
  type PlayerIndex,
  type ServerMessage,
} from "@majyan/core";
import { randomBytes, randomUUID } from "node:crypto";
import { MatchSession, type SessionSeat, type SessionTiming } from "./matchSession.js";
import type { RankService } from "./ranks.js";
import type { CollectionService } from "./collection.js";
import type { WalletService } from "./wallet.js";

export interface Client {
  readonly id: string;
  send(message: ServerMessage): void;
}

interface Member {
  userId: string;
  name: string;
  characterId: string | null;
  cardId: string | null;
  client: Client | null;
  seat: PlayerIndex | null;
}

interface Room {
  code: string;
  members: Member[];
  session: MatchSession | null;
  /** 人間が全員いなくなった部屋を片付けるタイマー。 */
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  /** 段位戦の卓ならその情報。段位戦の卓は合言葉で入れず、対局を最後まで打ち切る。 */
  ranked: { matchId: string; format: MatchFormat } | null;
}

/** 段位戦の卓に座る1人ぶん（matchmaking.tsが渡す）。 */
export interface RankedEntrant {
  client: Client;
  account: AccountProfile;
  characterId: string | null;
  cardId: string | null;
}

export interface RoomManagerOptions {
  /** ログイン用の鍵からアカウントを引く（accounts.tsのAccountService.authenticate）。 */
  authenticate: (token: string) => AccountProfile | null;
  rng?: () => number;
  now?: () => number;
  timing?: SessionTiming;
  /** 対局中に全員の接続が切れてから部屋を片付けるまでの時間。 */
  abandonedRoomMs?: number;
  /** 同時に存在できる部屋数の上限（大量に部屋を作られてメモリを食い潰されないように）。 */
  maxRooms?: number;
  /** 段位（席の表示と、段位戦の結果の反映に使う）。無ければ段位を扱わない。 */
  ranks?: RankService;
  /** 所持キャラ。あれば、持っていないキャラは使えない（おまかせは持っている中から選ぶ）。 */
  collections?: CollectionService;
  /** 雀玉（段位戦の報酬を渡す）。 */
  wallet?: WalletService;
}

const MAX_MEMBERS = 4;
const CPU_NAMES = ["CPU-A", "CPU-B", "CPU-C"];

function sanitize(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : null;
}

const validCharacter = (id: unknown) => (typeof id === "string" && id in CHARACTERS ? id : null);
const validCard = (id: unknown) => (typeof id === "string" && id in CARDS ? id : null);

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  /** 接続ID → 入っている部屋の合言葉。 */
  private readonly clientRooms = new Map<string, string>();
  private readonly rng: () => number;
  private readonly options: RoomManagerOptions;

  constructor(options: RoomManagerOptions) {
    this.options = options;
    this.rng = options.rng ?? Math.random;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** その接続が部屋（待合室・対局中）に入っているか。 */
  isInRoom(client: Client): boolean {
    return this.roomOf(client) !== undefined;
  }

  /** そのアカウントが座っている、まだ終わっていない段位戦の卓の合言葉。 */
  runningRankedRoomOf(userId: string): string | null {
    for (const room of this.rooms.values()) {
      if (room.ranked && room.session && !room.session.finished && room.members.some((m) => m.userId === userId)) return room.code;
    }
    return null;
  }

  /**
   * 段位戦の卓を立てて対局を始める。空いた席はCPUが入る。各人にmatchFoundを送った
   * あと、そのまま対局の状態が届く（入り直す時はmatchFoundの合言葉でjoinする）。
   */
  startRankedMatch(entrants: RankedEntrant[], format: MatchFormat): string {
    const matchId = randomUUID();
    // 入り直す時にjoinで使う合言葉。合言葉の最大文字数(ROOM_CODE_MAX_LENGTH)に収める。
    let code: string;
    do code = `ranked-${randomBytes(9).toString("base64url")}`;
    while (this.rooms.has(code));
    const room: Room = { code, members: [], session: null, cleanupTimer: null, ranked: { matchId, format } };
    this.rooms.set(code, room);
    for (const e of entrants) {
      if (this.clientRooms.has(e.client.id)) this.disconnect(e.client);
      room.members.push({
        userId: e.account.id,
        name: e.account.displayName,
        characterId: validCharacter(e.characterId),
        cardId: validCard(e.cardId),
        client: e.client,
        seat: null,
      });
      this.clientRooms.set(e.client.id, code);
      e.client.send({ t: "matchFound", room: code, format });
    }
    this.launch(room, format, false);
    return code;
  }

  handleMessage(client: Client, message: ClientMessage): void {
    switch (message.t) {
      case "join":
        this.join(client, message);
        return;
      case "leave":
        this.disconnect(client);
        return;
      case "queueRanked":
      case "cancelQueue":
        // 待ち行列はmatchmaking.tsが扱う（index.tsが振り分ける）。
        return;
    }
    const room = this.roomOf(client);
    const member = room?.members.find((m) => m.client?.id === client.id);
    if (!room || !member) {
      client.send({ t: "error", message: "部屋に入っていません", fatal: true });
      return;
    }
    switch (message.t) {
      case "setLoadout":
        if (room.session) return;
        member.characterId = validCharacter(message.characterId);
        member.cardId = validCard(message.cardId);
        this.broadcastLobby(room);
        return;
      case "start":
        this.start(room, member, client, message.format, !!message.continueBelowZero);
        return;
      case "action": {
        if (!room.session || member.seat === null) return;
        const error = room.session.handleAction(member.seat, message.action);
        if (error) client.send({ t: "error", message: error });
        return;
      }
      case "nextRound":
        if (room.session && member.seat !== null) room.session.handleNextRound(member.seat);
        return;
    }
  }

  /** 接続が切れた（またはタイトルへ戻った）。 */
  disconnect(client: Client): void {
    const room = this.roomOf(client);
    this.clientRooms.delete(client.id);
    if (!room) return;
    const member = room.members.find((m) => m.client?.id === client.id);
    if (!member) return;
    if (!room.session || room.session.finished) {
      room.members = room.members.filter((m) => m !== member);
      if (room.members.every((m) => !m.client)) {
        this.deleteRoom(room);
        return;
      }
      this.broadcastLobby(room);
      return;
    }
    member.client = null;
    room.session.setConnected(member.seat!, false);
    // 段位戦は全員抜けても片付けずに最後まで自動で打ち切る（抜ければ段位が
    // 動かない、という抜け道を作らないため）。終わった時点で片付ける。
    if (!room.ranked && !room.session.hasConnectedHuman()) {
      room.cleanupTimer = setTimeout(() => this.deleteRoom(room), this.options.abandonedRoomMs ?? 5 * 60_000);
    }
  }

  // -------------------------------------------------------------------------

  private roomOf(client: Client): Room | undefined {
    const code = this.clientRooms.get(client.id);
    return code === undefined ? undefined : this.rooms.get(code);
  }

  private join(client: Client, message: Extract<ClientMessage, { t: "join" }>): void {
    const account = this.options.authenticate(message.authToken);
    if (!account) {
      client.send({ t: "error", message: "ログインし直してください（アカウントが確認できませんでした）", fatal: true });
      return;
    }
    const code = sanitize(message.room, ROOM_CODE_MAX_LENGTH);
    if (!code) {
      client.send({ t: "error", message: "合言葉を入力してください", fatal: true });
      return;
    }
    // 別の部屋に入っていたら抜ける（同じ部屋へのjoinは入り直しとして下で扱う）。
    if (this.clientRooms.has(client.id) && this.clientRooms.get(client.id) !== code) this.disconnect(client);

    let room = this.rooms.get(code);
    if (!room && this.rooms.size >= (this.options.maxRooms ?? 500)) {
      client.send({ t: "error", message: "サーバーが混み合っています。しばらくしてからお試しください", fatal: true });
      return;
    }
    if (!room) {
      if (code.startsWith("ranked-")) {
        client.send({ t: "error", message: "この対局は終わっています", fatal: true });
        return;
      }
      room = { code, members: [], session: null, cleanupTimer: null, ranked: null };
      this.rooms.set(code, room);
    }

    const existing = room.members.find((m) => m.userId === account.id);
    if (existing && existing.client && existing.client.id !== client.id) {
      // 同じアカウントの古い接続がまだ残っている（別タブで開き直した、回線が
      // 切れたのにサーバーがまだ気づいていない等）。古い接続を追い出して引き継ぐ。
      const old = existing.client;
      this.clientRooms.delete(old.id);
      old.send({ t: "error", message: "別の画面から同じアカウントで入り直されたため、この画面の接続を切りました", fatal: true });
      existing.client = null;
    }

    if (room.session && !room.session.finished) {
      // 対局中: 自分の席がある人だけ戻れる。
      if (!existing || existing.seat === null) {
        client.send({ t: "error", message: "この部屋は対局中です", fatal: true });
        return;
      }
      existing.client = client;
      this.clientRooms.set(client.id, code);
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
      room.session.setConnected(existing.seat, true);
      client.send({ t: "state", view: room.session.viewFor(existing.seat) });
      return;
    }
    if (room.ranked) {
      client.send({ t: "error", message: "この対局は終わっています", fatal: true });
      return;
    }
    if (room.session?.finished) {
      // 前の対局が終わった部屋は、残っている人ごと新しい待合室に戻す。
      room.session.dispose();
      room.session = null;
      room.members = room.members.filter((m) => m.client || m === existing);
      for (const m of room.members) m.seat = null;
    }
    if (existing) {
      // 待合室に入り直した（名前が変わっていれば反映する）。
      existing.client = client;
      existing.name = account.displayName;
      existing.characterId = validCharacter(message.characterId);
      existing.cardId = validCard(message.cardId);
      this.clientRooms.set(client.id, code);
      this.broadcastLobby(room);
      return;
    }
    if (room.members.some((m) => m.name === account.displayName)) {
      client.send({ t: "error", message: "同じ名前の人が既に部屋にいます（名前を変えてから入ってください）", fatal: true });
      return;
    }
    if (room.members.length >= MAX_MEMBERS) {
      client.send({ t: "error", message: "この部屋は満員です", fatal: true });
      return;
    }
    room.members.push({
      userId: account.id,
      name: account.displayName,
      characterId: validCharacter(message.characterId),
      cardId: validCard(message.cardId),
      client,
      seat: null,
    });
    this.clientRooms.set(client.id, code);
    this.broadcastLobby(room);
  }

  private start(room: Room, member: Member, client: Client, format: MatchFormat, continueBelowZero: boolean): void {
    if (room.session) return;
    if (room.members[0] !== member) {
      client.send({ t: "error", message: "対局を始められるのは部屋主だけです" });
      return;
    }
    if (format !== "hanchan" && format !== "tonpuusen") return;
    this.launch(room, format, continueBelowZero);
  }

  private rankLabelOf(userId: string): string | null {
    return this.options.ranks?.get(userId).label ?? null;
  }

  /** 部屋の人を席に座らせて対局を始める（空いた席はCPU）。 */
  private launch(room: Room, format: MatchFormat, continueBelowZero: boolean): void {
    // 席はくじ引き（集まった順に関係なくランダム）。
    const seatOrder: PlayerIndex[] = [0, 1, 2, 3];
    for (let i = seatOrder.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [seatOrder[i], seatOrder[j]] = [seatOrder[j]!, seatOrder[i]!];
    }
    const characterIds = randomCharacterIds(this.rng);
    // 同じキャラを重ねて持っている（凸）ぶんの必殺技ゲージの上乗せ。CPUは0。
    const gaugeRateBonus: [number, number, number, number] = [0, 0, 0, 0];
    const cardIds: [string | null, string | null, string | null, string | null] = [null, null, null, null];
    const seats: SessionSeat[] = [];
    room.members.forEach((m, i) => {
      m.seat = seatOrder[i]!;
    });
    let cpuCount = 0;
    for (const seat of [0, 1, 2, 3] as PlayerIndex[]) {
      const m = room.members.find((x) => x.seat === seat);
      if (m) {
        const collections = this.options.collections;
        if (collections) {
          characterIds[seat] = collections.resolveCharacter(m.userId, m.characterId);
          gaugeRateBonus[seat] = collections.gaugeBonus(m.userId, characterIds[seat]);
        } else if (m.characterId) {
          characterIds[seat] = m.characterId;
        }
        cardIds[seat] = m.cardId;
        seats[seat] = { kind: "human", name: m.name, connected: !!m.client, rankLabel: this.rankLabelOf(m.userId) };
      } else {
        cardIds[seat] = randomCardId(this.rng);
        seats[seat] = { kind: "cpu", name: CPU_NAMES[cpuCount++]!, difficulty: DEFAULT_AI_DIFFICULTY };
      }
    }

    const match = createMatch(format, this.rng, characterIds, continueBelowZero, cardIds, gaugeRateBonus);
    room.session = new MatchSession({
      match,
      seats: seats as [SessionSeat, SessionSeat, SessionSeat, SessionSeat],
      rng: this.rng,
      now: this.options.now,
      timing: this.options.timing,
      send: (seat, view) => room.members.find((m) => m.seat === seat)?.client?.send({ t: "state", view }),
      onFinished: room.ranked ? (finished) => this.finishRanked(room, finished) : undefined,
    });
    room.session.start();
  }

  /** 段位戦が終わった: 人間の席の段位を更新して本人に知らせ、誰もいなければ片付ける。 */
  private finishRanked(room: Room, match: MatchState): void {
    const ranked = room.ranked;
    const ranks = this.options.ranks;
    if (!ranked || !ranks || !match.finalRanking) return;
    const results = room.members
      .filter((m) => m.seat !== null)
      .map((m) => ({
        userId: m.userId,
        seat: m.seat!,
        place: (match.finalRanking!.indexOf(m.seat!) + 1) as 1 | 2 | 3 | 4,
        finalScore: match.scores[m.seat!]!,
      }));
    const changes = ranks.recordMatch(ranked.matchId, ranked.format, results);
    for (const m of room.members) {
      const result = changes.get(m.userId);
      if (!result) continue;
      const jadeReward = this.options.wallet?.grantRankedReward(m.userId, ranked.format, result.place, ranked.matchId) ?? 0;
      m.client?.send({ t: "rankResult", result: { ...result, jadeReward } });
    }
    if (room.members.every((m) => !m.client)) setTimeout(() => this.deleteRoom(room), 0);
  }

  private broadcastLobby(room: Room): void {
    for (const target of room.members) {
      if (!target.client) continue;
      const members: LobbyMember[] = room.members.map((m, i) => ({
        name: m.name,
        characterId: m.characterId,
        cardId: m.cardId,
        isHost: i === 0,
        isYou: m === target,
      }));
      target.client.send({ t: "lobby", room: room.code, members });
    }
  }

  private deleteRoom(room: Room): void {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.session?.dispose();
    for (const m of room.members) if (m.client) this.clientRooms.delete(m.client.id);
    if (this.rooms.get(room.code) === room) this.rooms.delete(room.code);
  }
}
