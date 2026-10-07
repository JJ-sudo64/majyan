/**
 * 合言葉の部屋（友人戦）の管理。通信手段（WebSocket）には依存せず、
 * 接続をClientとして受け取る（index.tsがWebSocketとつなぐ）。
 *
 * - 同じ合言葉で入った人が同じ部屋に集まる（最大4人）。最初に入った人が部屋主
 * - 部屋主が開始すると、集まった人をランダムな席に座らせ、空いた席はCPUが入る
 * - 入るにはアカウント（accounts.ts）のログイン用の鍵が要る。名前はアカウントの表示名
 * - 対局中に接続が切れた人は、同じアカウントで入り直すとその席に戻れる
 * - 人間が全員いなくなった部屋は、しばらく誰も戻らなければ片付ける
 * - 対局中の部屋はstore（matchStore.ts）へ局面ごとに保存し、サーバーを再起動したら
 *   restoreSavedMatchesで作り直す。入り直す手順は切断からの復帰と同じ（同じ合言葉でjoin）
 */
import {
  createMatch,
  randomCardId,
  randomCharacterIds,
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
import { MatchSession, type MatchSessionOptions, type SessionSeat, type SessionSnapshot, type SessionTiming } from "./matchSession.js";
import type { MatchStore } from "./matchStore.js";
import type { RankService } from "./ranks.js";
import type { CollectionService } from "./collection.js";
import type { WalletService } from "./wallet.js";
import type { ReplayStore } from "./replays.js";

export interface Client {
  readonly id: string;
  send(message: ServerMessage): void;
}

interface Member {
  userId: string;
  name: string;
  /** 対局に出す手持ちのキャラ（collection.tsのcharacter_units）。null=おまかせ。 */
  unitId: string | null;
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
  /** 観戦している人（seatはその人が見に来たフレンドの席。その後ろから見る）。保存はしない。 */
  spectators: { client: Client; seat: PlayerIndex }[];
}

/** 1つの卓を同時に観戦できる人数。 */
const MAX_SPECTATORS = 8;

/** 段位戦の卓に座る1人ぶん（matchmaking.tsが渡す）。 */
export interface RankedEntrant {
  client: Client;
  account: AccountProfile;
  /** 対局に出す手持ちのキャラ（collection.tsのcharacter_units）。null=おまかせ。 */
  unitId: string | null;
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
  /** 対局中の部屋の保存先。無ければ保存しない（再起動で対局が消える）。 */
  store?: MatchStore;
  /** 段位戦の牌譜の保存先。無ければ牌譜を取らない。 */
  replays?: ReplayStore;
  /** CPUの思考を別スレッドで行う関数（cpuPool.ts）。無ければその場で考える。 */
  decideCpu?: MatchSessionOptions["decideCpu"];
  /** 観戦してよい相手か（フレンドか）を確かめ、その人のアカウントIDを返す。無ければ観戦できない。 */
  resolveSpectateTarget?: (viewerUserId: string, friendCode: string) => string | null;
  /** 再起動して対局を戻した直後、人間が入り直してくるのを待つ時間（その間は自動操作しない）。 */
  restoreGraceMs?: number;
}

/** 保存する部屋の中身。形を変えて古い保存が読めなくなる時はversionを上げる（古いものは捨てる）。 */
interface RoomSnapshot {
  version: number;
  code: string;
  ranked: Room["ranked"];
  members: { userId: string; name: string; unitId: string | null; seat: PlayerIndex | null }[];
  session: SessionSnapshot;
}
const ROOM_SNAPSHOT_VERSION = 1;
const DEFAULT_RESTORE_GRACE_MS = 60_000;

const MAX_MEMBERS = 4;
const CPU_NAMES = ["CPU-A", "CPU-B", "CPU-C"];

function sanitize(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : null;
}

const validUnitId = (id: unknown) => (typeof id === "string" && id.length > 0 && id.length <= 64 ? id : null);

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  /** 接続ID → 入っている部屋の合言葉。 */
  private readonly clientRooms = new Map<string, string>();
  /** 観戦中の接続ID → 観戦している部屋の合言葉。 */
  private readonly spectatorRooms = new Map<string, string>();
  private readonly rng: () => number;
  private readonly options: RoomManagerOptions;

  constructor(options: RoomManagerOptions) {
    this.options = options;
    this.rng = options.rng ?? Math.random;
  }

  /**
   * 起動時に1回呼ぶ: 保存されていた対局の部屋を作り直して続きを始める。戻した数を返す。
   * 人間は全員切断中から始まり、同じ合言葉でjoinすれば元の席に戻れる。
   */
  restoreSavedMatches(): number {
    const store = this.options.store;
    if (!store) return 0;
    let restored = 0;
    for (const { roomCode, snapshot } of store.loadAll()) {
      const snap = snapshot as RoomSnapshot;
      if (snap?.version !== ROOM_SNAPSHOT_VERSION || snap.code !== roomCode || this.rooms.has(roomCode)) {
        store.delete(roomCode);
        continue;
      }
      const room: Room = {
        code: roomCode,
        members: snap.members.map((m) => ({ ...m, client: null })),
        session: null,
        cleanupTimer: null,
        ranked: snap.ranked,
        spectators: [],
      };
      try {
        this.rooms.set(roomCode, room);
        room.session = MatchSession.restore(snap.session, this.sessionOptions(room));
        room.session.resume(this.options.restoreGraceMs ?? DEFAULT_RESTORE_GRACE_MS);
        // 友人戦は誰も戻らなければ片付ける（段位戦は最後まで打ち切る。disconnect参照）。
        if (!room.ranked) this.scheduleAbandonedCleanup(room);
        restored++;
      } catch (err) {
        console.error(`[majyan-server] 保存された対局を再開できなかったため消します: ${roomCode}`, err);
        this.deleteRoom(room);
      }
    }
    return restored;
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
   * フレンドの一覧に出す、その人の今の様子。友人戦の待合室にいて（接続中・満員でない）なら
   * その合言葉（フレンドが同じ部屋に入れるように）、対局中なら"playing"、どちらでもなければnull。
   */
  presenceOf(userId: string): { room: string } | "playing" | null {
    let playing = false;
    for (const room of this.rooms.values()) {
      const member = room.members.find((m) => m.userId === userId);
      if (!member) continue;
      if (room.session && !room.session.finished) {
        if (member.client) playing = true;
      } else if (!room.session && !room.ranked && member.client && room.members.length < MAX_MEMBERS) {
        return { room: room.code };
      }
    }
    return playing ? "playing" : null;
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
    const room: Room = { code, members: [], session: null, cleanupTimer: null, ranked: { matchId, format }, spectators: [] };
    this.rooms.set(code, room);
    for (const e of entrants) {
      if (this.clientRooms.has(e.client.id)) this.disconnect(e.client);
      room.members.push({
        userId: e.account.id,
        name: e.account.displayName,
        unitId: validUnitId(e.unitId),
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
      case "spectate":
        this.spectate(client, message);
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
        member.unitId = validUnitId(message.unitId);
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

  /** フレンドの対局を観戦する。誰の手の内も見えない画面を、そのフレンドの席の後ろから見せる。 */
  private spectate(client: Client, message: Extract<ClientMessage, { t: "spectate" }>): void {
    const account = this.options.authenticate(message.authToken);
    if (!account) {
      client.send({ t: "error", message: "ログインし直してください（アカウントが確認できませんでした）", fatal: true });
      return;
    }
    const targetId = this.options.resolveSpectateTarget?.(account.id, message.friendCode) ?? null;
    if (!targetId) {
      client.send({ t: "error", message: "観戦できるのはフレンドの対局だけです", fatal: true });
      return;
    }
    if (this.roomOf(client) || this.spectatorRooms.has(client.id)) this.disconnect(client);
    // 抜けたまま自動で続いている卓に座っていることもあるので、今つながっている卓を優先する。
    const candidates = [...this.rooms.values()]
      .map((room) => ({ room, target: room.members.find((m) => m.userId === targetId && m.seat !== null) }))
      .filter((c) => c.target && c.room.session && !c.room.session.finished)
      .sort((a, b) => Number(!!b.target!.client) - Number(!!a.target!.client));
    for (const { room, target } of candidates) {
      if (!target || !room.session) continue;
      if (room.members.some((m) => m.userId === account.id)) {
        client.send({ t: "error", message: "自分が座っている卓は観戦できません", fatal: true });
        return;
      }
      if (room.spectators.length >= MAX_SPECTATORS) {
        client.send({ t: "error", message: "この卓は観戦する人がいっぱいです", fatal: true });
        return;
      }
      room.spectators.push({ client, seat: target.seat! });
      this.spectatorRooms.set(client.id, room.code);
      client.send({ t: "state", view: room.session.spectatorView(target.seat!) });
      return;
    }
    client.send({ t: "error", message: "そのフレンドは今対局していません", fatal: true });
  }

  private sendToSpectators(room: Room): void {
    if (!room.session) return;
    for (const sp of room.spectators) sp.client.send({ t: "state", view: room.session.spectatorView(sp.seat) });
  }

  /** 接続が切れた（またはタイトルへ戻った）。 */
  disconnect(client: Client): void {
    const watching = this.spectatorRooms.get(client.id);
    if (watching !== undefined) {
      this.spectatorRooms.delete(client.id);
      const r = this.rooms.get(watching);
      if (r) r.spectators = r.spectators.filter((sp) => sp.client.id !== client.id);
      return;
    }
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
    if (!room.ranked && !room.session.hasConnectedHuman()) this.scheduleAbandonedCleanup(room);
  }

  // -------------------------------------------------------------------------

  private scheduleAbandonedCleanup(room: Room): void {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => this.deleteRoom(room), this.options.abandonedRoomMs ?? 5 * 60_000);
  }

  /** 対局（MatchSession）に渡す、部屋とのつなぎ（送信・終了時の処理・保存）。 */
  private sessionOptions(room: Room): Omit<MatchSessionOptions, "match" | "seats"> {
    return {
      rng: this.rng,
      now: this.options.now,
      timing: this.options.timing,
      send: (seat, view) => room.members.find((m) => m.seat === seat)?.client?.send({ t: "state", view }),
      onFinished: room.ranked ? (finished) => this.finishRanked(room, finished) : undefined,
      onChange: () => this.persist(room),
      onBroadcast: () => this.sendToSpectators(room),
      decideCpu: this.options.decideCpu,
      onRoundRecorded:
        room.ranked && this.options.replays
          ? (roundIndex, round) => this.options.replays!.saveRound(room.ranked!.matchId, roundIndex, round)
          : undefined,
    };
  }

  /** 対局中の部屋を保存する（終わった対局は消す）。 */
  private persist(room: Room): void {
    const store = this.options.store;
    if (!store || !room.session || this.rooms.get(room.code) !== room) return;
    if (room.session.finished) {
      store.delete(room.code);
      return;
    }
    const snapshot: RoomSnapshot = {
      version: ROOM_SNAPSHOT_VERSION,
      code: room.code,
      ranked: room.ranked,
      members: room.members.map((m) => ({ userId: m.userId, name: m.name, unitId: m.unitId, seat: m.seat })),
      session: room.session.snapshot(),
    };
    store.save(room.code, snapshot);
  }

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
      room = { code, members: [], session: null, cleanupTimer: null, ranked: null, spectators: [] };
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
      existing.unitId = validUnitId(message.unitId);
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
      unitId: validUnitId(message.unitId),
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
    const cardIds: [string | null, string | null, string | null, string | null] = [null, null, null, null];
    const seats: SessionSeat[] = [];
    room.members.forEach((m, i) => {
      m.seat = seatOrder[i]!;
    });
    let cpuCount = 0;
    for (const seat of [0, 1, 2, 3] as PlayerIndex[]) {
      const m = room.members.find((x) => x.seat === seat);
      if (m) {
        // 手持ちのキャラを、付いているカードごと出す（持っていないキャラは選べない）。
        const unit = this.options.collections?.resolveUnit(m.userId, m.unitId);
        if (unit) {
          characterIds[seat] = unit.characterId;
          cardIds[seat] = unit.cardId;
        }
        seats[seat] = { kind: "human", name: m.name, connected: !!m.client, rankLabel: this.rankLabelOf(m.userId) };
      } else {
        cardIds[seat] = randomCardId(this.rng);
        seats[seat] = { kind: "cpu", name: CPU_NAMES[cpuCount++]!, difficulty: DEFAULT_AI_DIFFICULTY };
      }
    }

    const match = createMatch(format, this.rng, characterIds, continueBelowZero, cardIds);
    room.session = new MatchSession({
      ...this.sessionOptions(room),
      match,
      seats: seats as [SessionSeat, SessionSeat, SessionSeat, SessionSeat],
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
    const round = match.round;
    const seats = ([0, 1, 2, 3] as PlayerIndex[]).map((seat) => ({
      seat,
      userId: room.members.find((m) => m.seat === seat)?.userId ?? null,
      name: room.session?.seatName(seat) ?? "",
      characterId: round.characterIds[seat],
      cardId: round.cardIds[seat],
      place: (match.finalRanking!.indexOf(seat) + 1) as 1 | 2 | 3 | 4,
      finalScore: match.scores[seat],
    }));
    const changes = ranks.recordMatch(ranked.matchId, ranked.format, results, seats);
    for (const m of room.members) {
      const result = changes.get(m.userId);
      if (!result) continue;
      const jadeReward = this.options.wallet?.grantRankedReward(m.userId, ranked.format, result.place, ranked.matchId) ?? 0;
      m.client?.send({ t: "rankResult", result: { ...result, jadeReward } });
    }
    if (room.members.every((m) => !m.client)) setTimeout(() => this.deleteRoom(room), 0);
  }

  /** 待合室に出す、その人が選んだキャラとカード（おまかせならnull）。 */
  private describeUnit(m: Member): { characterId: string | null; cardId: string | null } {
    const unit = m.unitId ? this.options.collections?.units(m.userId).find((u) => u.unitId === m.unitId) : undefined;
    return { characterId: unit?.characterId ?? null, cardId: unit?.cardId ?? null };
  }

  private broadcastLobby(room: Room): void {
    for (const target of room.members) {
      if (!target.client) continue;
      const members: LobbyMember[] = room.members.map((m, i) => ({
        name: m.name,
        ...this.describeUnit(m),
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
    for (const sp of room.spectators) this.spectatorRooms.delete(sp.client.id);
    room.spectators = [];
    if (this.rooms.get(room.code) === room) {
      this.rooms.delete(room.code);
      this.options.store?.delete(room.code);
    }
  }
}
