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
  type MatchFormat,
  type PlayerIndex,
  type ServerMessage,
} from "@majyan/core";
import { MatchSession, type SessionSeat, type SessionTiming } from "./matchSession.js";

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

  handleMessage(client: Client, message: ClientMessage): void {
    switch (message.t) {
      case "join":
        this.join(client, message);
        return;
      case "leave":
        this.disconnect(client);
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
    if (!room.session.hasConnectedHuman()) {
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
    if (this.clientRooms.has(client.id)) this.disconnect(client);

    let room = this.rooms.get(code);
    if (!room && this.rooms.size >= (this.options.maxRooms ?? 500)) {
      client.send({ t: "error", message: "サーバーが混み合っています。しばらくしてからお試しください", fatal: true });
      return;
    }
    if (!room) {
      room = { code, members: [], session: null, cleanupTimer: null };
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

    // 席はくじ引き（集まった順に関係なくランダム）。
    const seatOrder: PlayerIndex[] = [0, 1, 2, 3];
    for (let i = seatOrder.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [seatOrder[i], seatOrder[j]] = [seatOrder[j]!, seatOrder[i]!];
    }
    const characterIds = randomCharacterIds(this.rng);
    const cardIds: [string | null, string | null, string | null, string | null] = [null, null, null, null];
    const seats: SessionSeat[] = [];
    room.members.forEach((m, i) => {
      m.seat = seatOrder[i]!;
    });
    let cpuCount = 0;
    for (const seat of [0, 1, 2, 3] as PlayerIndex[]) {
      const m = room.members.find((x) => x.seat === seat);
      if (m) {
        if (m.characterId) characterIds[seat] = m.characterId;
        cardIds[seat] = m.cardId;
        seats[seat] = { kind: "human", name: m.name, connected: !!m.client };
      } else {
        cardIds[seat] = randomCardId(this.rng);
        seats[seat] = { kind: "cpu", name: CPU_NAMES[cpuCount++]!, difficulty: DEFAULT_AI_DIFFICULTY };
      }
    }

    const match = createMatch(format, this.rng, characterIds, continueBelowZero, cardIds);
    room.session = new MatchSession({
      match,
      seats: seats as [SessionSeat, SessionSeat, SessionSeat, SessionSeat],
      rng: this.rng,
      now: this.options.now,
      timing: this.options.timing,
      send: (seat, view) => room.members.find((m) => m.seat === seat)?.client?.send({ t: "state", view }),
    });
    room.session.start();
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
