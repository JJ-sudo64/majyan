/**
 * 公式ページの英語版（/en/）を、日本語版のHTMLから作る。
 * 日本語版（packages/web/public/about/index.html）を元に、文言を英語に置き換える。
 * キャラ・カード・段位のデータは、ゲーム内の対訳表（packages/web/src/i18n/en-data.ts）を使う。
 * 日本語版の文言を変えたら、下の REPLACEMENTS も合わせて直す（合わない所は実行時に気づけるよう、
 * 置き換えの後に日本語が残っていればエラーにする）。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** en-data.ts（{ 日本語: 英語 } の対訳表）を読む。 */
function loadEnData() {
  const src = readFileSync(join(root, "packages/web/src/i18n/en-data.ts"), "utf8");
  return JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
}

/** [日本語の断片, 英語]。上から順に、全て置き換える（長いものを先に書く）。 */
export const REPLACEMENTS = [
  // --- head / メタ情報 ---
  ['<html lang="ja">', '<html lang="en">'],
  ["雀杯 公式サイト｜必殺技で卓が動く、異能麻雀バトル", "Janhai Official Site | Skill-Powered Mahjong Battles"],
  [
    "雀杯（じゃんはい）は、個性豊かな雀士たちがそれぞれ持つ必殺技と、運命を変えるカードで戦う異能麻雀バトル。無料のブラウザ麻雀ゲームで、4人打ちリーチ麻雀を段位戦・友人戦・CPU戦で遊べます。",
    "Janhai is a free browser mahjong game where a cast of quirky players fight with unique special skills and fate-changing cards. Play 4-player Riichi mahjong in ranked matches, friend matches and vs CPU.",
  ],
  ["雀杯｜必殺技で卓が動く、異能麻雀バトル", "Janhai | Skill-Powered Mahjong Battles"],
  ["個性豊かな雀士と、運命を変えるカード。ブラウザですぐ遊べる異能麻雀バトル。", "Quirky players and fate-changing cards. Skill-powered mahjong you can play right in your browser."],
  ['property="og:site_name" content="雀杯"', 'property="og:site_name" content="Janhai"'],
  ['content="ja_JP"', 'content="en_US"'],
  ['"inLanguage": "ja"', '"inLanguage": "en"'],
  ['"genre": "麻雀"', '"genre": "Mahjong"'],
  ['"name": "雀杯"', '"name": "Janhai"'],
  // --- FAQ（構造化データとHTMLの両方に出る） ---
  ["配信や動画に使ってもいいですか？", "Can I use the game in streams and videos?"],
  [
    "配信や動画での利用は自由です。事前の連絡や許可は要りません。ゲーム画面の録画・ライブ配信・実況動画の投稿にご自由にお使いください。",
    "Yes — streaming and video use is free. You don't need to contact us or ask for permission. Feel free to record gameplay, livestream it, or post commentary videos.",
  ],
  ["麻雀のルールを知らなくても遊べますか？", "Can I play without knowing the rules of mahjong?"],
  [
    "ゲーム内の「ルール」から基本を確認できます。CPU戦なら自分のペースで練習でき、ツモ切りや和了を自動にする機能もあります。",
    "You can check the basics under \"Rules\" in the game. In vs CPU you can practice at your own pace, and there are options to auto-discard and auto-win.",
  ],
  ["どの端末で遊べますか？", "What devices can I play on?"],
  [
    "パソコン・スマートフォン・タブレットのブラウザで遊べます。画面は横長で、スマホを縦に持っていても自動で横向きに表示します。ホーム画面に追加すると、アプリのように全画面で起動できます。",
    "You can play in the browser on a PC, smartphone or tablet. The screen is landscape, and on a phone held upright it automatically displays sideways. If you add it to your home screen, it launches full-screen like an app.",
  ],
  ["アカウント登録は必要ですか？", "Do I need to register an account?"],
  [
    "不要です。名前を決めるだけで始められます。ブラウザのデータを消した時や端末を変える時のために、始めたあとでゲーム内の「引き継ぎ」からパスワードを決めて、発行される引き継ぎコードを控えておいてください。コードとパスワードで、手持ちをそのまま移せます。",
    "No. You can start just by choosing a name. In case you clear your browser data or change devices, after starting please set a password under \"Transfer\" in the game and keep a note of the transfer code it gives you. With the code and password you can move everything you own as it is.",
  ],
  ["必殺技はいつ使えますか？", "When can I use a skill?"],
  [
    "対局中に必殺技ゲージが溜まり、満タンになると使えます。自分で好きな時に発動する技のほか、リーチと同時に自動で発動する技、条件を満たすと常に効くパッシブの技もあります。",
    "During a match your skill gauge fills up, and when it's full you can use the skill. Some skills you trigger whenever you like, some trigger automatically when you declare Riichi, and some are passive skills that always work once their conditions are met.",
  ],
  ["カードは付け替えられますか？", "Can I swap cards?"],
  [
    "カードはキャラ1体に、パッシブ1枚とアクティブ1枚まで付けられます。一度付けると外せません。同じキャラを複数持っていれば、それぞれに別のカードを付けて使い分けられます。",
    "Each character can equip one Passive and one Active card. Once equipped, a card can't be removed. If you own several copies of the same character, you can equip different cards on each and switch between them.",
  ],
  ["CPU戦でもガチャで出したキャラしか使えませんか？", "In vs CPU, can I only use characters I pulled from the gacha?"],
  [
    "CPU戦では全キャラ・全カードを自由に使えます。オンライン（段位戦・友人戦）では、手持ちのキャラとカードで対局します。",
    "In vs CPU you can freely use every character and card. In online play (ranked and friend matches), you play with the characters and cards you own.",
  ],
  // --- ヘッダー・ナビ ---
  ['aria-label="雀杯 トップへ"', 'aria-label="Janhai – back to top"'],
  ['alt="" />雀杯</a>', 'alt="" />Janhai</a>'],
  [">ゲーム紹介<", ">About<"],
  [">キャラクター<", ">Characters<"],
  [">モード<", ">Modes<"],
  [">段位戦<", ">Ranked<"],
  [">カード<", ">Cards<"],
  [">システム<", ">System<"],
  [">よくある質問<", ">FAQ<"],
  [">今すぐプレイ<", ">Play now<"],
  ['aria-label="メニュー"', 'aria-label="Menu"'],
  // --- ヒーロー ---
  [
    '必殺技が飛び交う、<br /><span class="gold-text">異能</span>の麻雀卓。',
    'A mahjong table<br />where <span class="gold-text">skills</span> fly.',
  ],
  [
    '突如として始まった雀杯戦争。<br />そこに集う<span data-count="characters">27</span>人の雀士は、みんなクセ者。牌を透かす、時を止める、牌を交換する——<br />本格リーチ麻雀に「必殺技」と「カード」が加わり、戦略性が大幅に広がった。<br />集めて、組んで、勝ち上がれ。伝説の<span class="gold-text">雀杯</span>を手に入れろ。',
    'The Janhai War has suddenly begun.<br />The <span data-count="characters">27</span> players gathered here are all oddballs. See through tiles, stop time, swap tiles—<br />Special skills and cards on top of real Riichi mahjong open up a whole new level of strategy.<br />Collect, build, and fight your way up. Win the legendary <span class="gold-text">Janhai Cup</span>.',
  ],
  ["ブラウザで今すぐプレイ", "Play in your browser now"],
  [">キャラクターを見る<", ">Meet the characters<"],
  [">公式Xをフォロー<", ">Follow us on X<"],
  [">ダウンロード不要<", ">No download<"],
  [">スマホ・PC対応<", ">Phone & PC<"],
  [">ゲストですぐ始められる<", ">Start right away as a guest<"],
  // --- PV ---
  ['まずは、<span class="gold-text">雀杯</span>の卓へ。', 'First, step up to the <span class="gold-text">Janhai</span> table.'],
  ["お使いのブラウザは動画に対応していません。", "Your browser doesn't support video."],
  // --- ゲーム紹介 ---
  [
    '読み合いの卓に、<br />ド派手な<span class="gold-text">必殺技</span>をぶち込め。',
    'Slam a flashy <span class="gold-text">skill</span><br />into the battle of reads.',
  ],
  [
    "ルールは本格的な4人打ちリーチ麻雀。そこに、局面をひっくり返す必殺技と、運命を変えるカードが加わります。「あの技、いつ来る？」——牌だけでは読み切れない、ワクワクする駆け引きをどうぞ。",
    "The rules are real 4-player Riichi mahjong. On top of that come skills that flip the situation and cards that change fate. \"When will that skill hit?\" — enjoy an exciting game of cat and mouse that you can't read from the tiles alone.",
  ],
  ["技が決まる、気持ちよさ", "The thrill of a skill landing"],
  [
    "打つたびにゲージが溜まり、満タンで発動。牌を引き直す、ドラを増やす、相手の手牌を透視する——技の数だけ戦い方があります。",
    "The gauge fills with every discard and fires when full. Redraw a tile, add dora, see through opponents' hands — there's a different way to play for every skill.",
  ],
  ["組み合わせで化けるカード", "Cards that shine in combination"],
  [
    "キャラ1体に、常に効く「パッシブ」と、ここぞで切る「アクティブ」を1枚ずつ付けて対局へ。",
    "Equip each character with one \"Passive\" that's always on and one \"Active\" to play at the crucial moment, then head into the match.",
  ],
  ["種のカードで、自分だけの組み合わせを。", " cards to build your own combination."],
  ["決着は、一枚絵で魅せる", "Finish with a full-art flourish"],
  [
    "4人打ち・赤ドラ入りの東風戦／半荘戦。和了の瞬間には、キャラごとに描き下ろしたリーチ・ツモ・ロンの宣言演出が卓を染めます。",
    "4-player games with red dora, in East-only or Hanchan format. The moment you win, hand-drawn Riichi, Tsumo and Ron declaration cut-ins for each character wash over the table.",
  ],
  ['alt="ゼノの必殺技「時間停止」"', 'alt="Zeno\'s skill \\"Time Stop\\""'],
  ['alt="カードを選ぶ画面。パッシブとアクティブのカードが並ぶ"', 'alt="The card selection screen, with Passive and Active cards lined up"'],
  ['alt="対局画面"', 'alt="Match screen"'],
  // --- キャラクター ---
  ['卓を囲む、<span data-count="characters">27</span>人の雀士', 'The <span data-count="characters">27</span> players around the table'],
  ["巫女、忍、賭け師、そしてパンダ。誰と組むかで、あなたの麻雀は変わります。", "Priestesses, ninjas, gamblers, and a panda. Who you team up with changes your mahjong."],
  ['aria-label="前のキャラ"', 'aria-label="Previous character"'],
  ['aria-label="次のキャラ"', 'aria-label="Next character"'],
  [">すべて<", ">All<"],
  // --- 宣言演出 ---
  ['決まった瞬間、卓が<span class="gold-text">主役</span>に染まる。', 'The moment it lands, the table is <span class="gold-text">taken over</span>.'],
  [
    "リーチ、ツモ、ロン、そして必殺技。キャラクターごとに用意した宣言演出が、決着の瞬間を彩ります。",
    "Riichi, Tsumo, Ron, and skills. Declaration cut-ins prepared for each character light up the moment of decision.",
  ],
  ["画像をクリックすると拡大します", "Click an image to enlarge it"],
  ['"ライコ「一閃」"', '"Raiko \\"Flash\\""'],
  ['"カゲロウ「透視の術」"', '"Kagerou \\"Art of Sight\\""'],
  ['"ルナ「運命の采配」"', '"Runa \\"Fate\'s Arrangement\\""'],
  ['"カエデ　ツモ"', '"Kaede  Tsumo"'],
  ['"ゼノ　ロン"', '"Zeno  Ron"'],
  ['"南南　リーチ"', '"Nannan  Riichi"'],
  ['"ジン「大明立直」"', '"Jin \\"Open Declaration\\""'],
  ['"コウキ　ロン"', '"Kouki  Ron"'],
  ['"カガミ「写し身」"', '"Kagami \\"Mirror Image\\""'],
  ['`${i + 1}枚目`', '`Slide ${i + 1}`'],
  // --- モード ---
  ["ひとりでも、みんなとでも。", "Solo or with everyone."],
  ["段位戦・友人戦", "Ranked & friend matches"],
  [
    "全国のプレイヤーと腕を競う段位戦。合言葉を決めれば、友だち同士で同じ卓にも座れます。",
    "Compete against players everywhere in ranked matches. Pick a passphrase and you can sit at the same table as your friends.",
  ],
  ["段位の近い相手と自動で卓を組む段位戦（東風戦・半荘戦）", "Ranked matches that automatically seat you with similar-rank players (East-only and Hanchan)"],
  ["同じ合言葉を入れた人どうしで遊べる友人戦", "Friend matches for people who enter the same passphrase"],
  ["フレンドの対局を観戦、自分の対局は牌譜で振り返り", "Watch friends' matches, and review your own with replays"],
  ["対局中に気持ちを伝えるスタンプ", "Stamps to express yourself during a match"],
  ['alt="オンラインのホーム画面"', 'alt="The online home screen"'],
  ['alt="CPU戦の準備画面"', 'alt="The vs CPU setup screen"'],
  [">CPU戦<", ">vs CPU<"],
  [
    "CPU3人と、いつでも気軽に。全キャラ・全カードを自由に選べるので、技の研究や組み合わせ探しにも最適です。",
    "Play against 3 CPUs any time. You can freely choose every character and card, which makes it perfect for studying skills and finding combinations.",
  ],
  ["全キャラ・全カードが最初から使い放題", "Every character and card is available from the start"],
  ["相手のキャラと強さを1人ずつ選べる", "Choose each opponent's character and strength"],
  ["東風戦・半荘戦、箱下続行のあり・なしを選択", "Choose East-only or Hanchan, and whether to play on below zero"],
  ["迫力の3D卓", "A powerful 3D table"],
  [
    "立体的に描いた卓で、牌を打つ手応えをそのままに。スマホでもPCでも同じ横長の画面で遊べます。",
    "A table drawn in 3D keeps the feel of slapping down tiles. Play on the same landscape screen on a phone or a PC.",
  ],
  ["必殺技ゲージは対局中いつでも確認できる", "Check your skill gauge any time during a match"],
  ["ツモ切り・和了の自動操作でテンポよく", "Auto-discard and auto-win keep the pace brisk"],
  ["縦持ちのスマホでも自動で横向き表示に", "Even a phone held upright automatically switches to landscape"],
  // --- 段位 ---
  ['伝説の<span class="gold-text">雀杯</span>を手に入れろ', 'Win the legendary <span class="gold-text">Janhai Cup</span>'],
  [
    '<span class="nw">段位戦の順位でポイントが増減し、</span><span class="nw">たまれば昇段。</span><br /><span class="nw">下雀から始まり、</span><span class="nw"><span data-count="rankTiers">5</span>つの段位をそれぞれ3段ずつ駆け上がれ。</span><br /><span class="nw">その先に待つのは、</span><span class="nw">卓に生き、牌に溺れた者だけが辿り着く、</span><span class="nw">頂点――雀神の座。</span>',
    '<span class="nw">Your ranked placements add and subtract points, </span><span class="nw">and enough points promote you.</span><br /><span class="nw">Start at Rookie and climb </span><span class="nw"><span data-count="rankTiers">5</span> ranks, three tiers each.</span><br /><span class="nw">Waiting beyond them, </span><span class="nw">reached only by those who lived at the table and drowned in tiles, </span><span class="nw">is the summit — the seat of God.</span>',
  ],
  ["東風戦・半荘戦", "East-only & Hanchan"],
  [
    "短く遊べる東風戦と、じっくり戦う半荘戦。半荘戦のほうがポイントの増減が大きくなります。",
    "A short East-only game, or a long Hanchan to really fight it out. Points move more in a Hanchan.",
  ],
  ["降段もある、本気の段位戦", "Demotion included — ranked, for real"],
  [
    "最下段の下雀1段だけは降段なし。それ以外は、ポイントが0を下回ると降段します。4位で失うポイントは、段位が上がるほど大きくなります。",
    "Only the lowest tier, Rookie 1, has no demotion. Everywhere else, you're demoted when your points drop below 0. The points you lose for 4th place grow larger the higher your rank.",
  ],
  ["ここからが、本当の沼", "This is where the real swamp begins"],
  [
    "最高位の雀神には段がありません。あるのは、積み上がっていくポイントだけ。頂点の座で、数字を競い合おう。",
    "The top rank, God, has no tiers. There are only the points that keep stacking up. Compete on the numbers from the summit.",
  ],
  ["`1段〜${r.levels}段${r.canDemote ? \"\" : \"・降段なし\"}`", "`Tiers 1–${r.levels}${r.canDemote ? \"\" : \" · no demotion\"}`"],
  ['"段なし・青天井"', '"No tiers · no cap"'],
  // --- カード ---
  ['<span data-count="cards">82</span>種のカードで、戦い方は無限大', 'Endless ways to play with <span data-count="cards">82</span> cards'],
  [
    "カードはキャラ1体に、パッシブとアクティブを1枚ずつ。持っているだけで効く「パッシブ」と、好きな時に使う「アクティブ」があります。一度付けたカードは外せないので、組み合わせは慎重に。",
    "Each character equips one Passive and one Active card. \"Passive\" cards work just by being equipped, and \"Active\" cards are used whenever you like. An equipped card can't be removed, so choose your combination carefully.",
  ],
  ['"すべてのカードを見る"', '"See all cards"'],
  ['>すべてのカードを見る<', '>See all cards<'],
  ['"閉じる"', '"Close"'],
  // --- システム ---
  ['推しを引いて、<span class="gold-text">最強</span>の布陣を。', 'Pull your favorites. Build the <span class="gold-text">strongest</span> lineup.'],
  [">ガチャ<", ">Gacha<"],
  ["キャラとカードが出る。", "Characters and cards can appear. "],
  ["10連は★★以上が1枠確定", "A 10-pull guarantees one ★★ or better"],
  ["1回引くごとに交換ポイントが1たまり、", "Every pull gives 1 exchange point, and at "],
  ["ポイントで★★★のキャラかカードをランダムで1つ", " points you get a random ★★★ character or card"],
  [">もらえる。<", ">.<"],
  ["期間ごとの", "In limited-time "],
  [">ピックアップ<", ">Pickups<"],
  ["では、対象のキャラやカードが出やすくなる。", ", the featured characters and cards are easier to get."],
  [
    "同じキャラが出たら、別の個体として手持ちが増える。カードを付け分けて使い分けよう。",
    "If you pull the same character again, it joins your collection as a separate copy. Equip different cards on each and switch between them.",
  ],
  ["雀玉はログインボーナスやミッションでも手に入る。", "You can also earn Jade from login bonuses and missions."],
  ["はじめての10連は、", "Your first 10-pull can be "],
  ["納得いくまで何度でも引き直し", "redrawn as many times as you like"],
  [">できる。<", "> until you're happy.<"],
  [">遊びやすさ<", ">Easy to play<"],
  ["ブラウザで開けばすぐ遊べる。ホーム画面に追加すればアプリのように起動。", "Open it in your browser and play right away. Add it to your home screen to launch it like an app."],
  ["どの端末でも同じ横長の画面。縦持ちでも自動で横向きに。", "The same landscape screen on any device. Even held upright, it switches to landscape automatically."],
  [">引き継ぎコード<", ">Transfer code<"],
  ["機種変更しても、コードとパスワードで手持ちをそのまま移せる。", "Even if you change devices, a code and password carry your collection over as it is."],
  [">ミッション<", ">Missions<"],
  ["目標をこなして、雀玉などの報酬を受け取ろう。", "Complete objectives and collect rewards like Jade."],
  [">戦績・ランキング<", ">Record & ranking<"],
  ["これまでの成績を振り返り、上位プレイヤーと比べられる。", "Look back on your results and compare yourself with top players."],
  [">フレンド<", ">Friends<"],
  ["フレンドになれば観戦や友人戦の誘いがかんたんに。", "Once you're friends, watching matches and inviting to friend matches is easy."],
  // --- はじめかた ---
  [">はじめかた<", ">How to start<"],
  [">ブラウザで開く<", ">Open it in your browser<"],
  ["このページの「今すぐプレイ」から。インストールは要りません。", "Use \"Play now\" on this page. No installation needed."],
  [">名前を決める<", ">Pick a name<"],
  ["オンラインに入って名前を決めるだけ。メールアドレスなどの登録は不要です。", "Just go online and choose a name. No email address or other registration is needed."],
  [">最初の10連ガチャ<", ">Your first 10-pull<"],
  ["最初の仲間を迎えるガチャ。気に入る結果が出るまで引き直せます。", "A gacha for welcoming your first companions. Redraw until you like the result."],
  [">卓につく<", ">Take a seat<"],
  ["まずはCPU戦で技を試すもよし、いきなり段位戦に挑むもよし。", "Try out skills against the CPU first, or jump straight into ranked."],
  // --- 締め・フッター ---
  ["さあ、卓につこう。", "Now, take your seat."],
  ['alt="雀杯"', 'alt="Janhai"'],
  [">ゲームを始める<", ">Play the game<"],
  [">公式X<", ">Official X<"],
  ["© 2026 雀杯", "© 2026 Janhai"],
];

/** 英語版の元（JSONのデータ）で、見た目に出る語。 */
const TYPE_EN = { パッシブ: "Passive", アクティブ: "Active" };

/** 日本語版のHTML（住所の書き換えまで済んだもの）から、英語版のHTMLを作る。 */
export function buildEnglishPage(html, { siteUrl, gameUrl }) {
  const enData = loadEnData();
  let out = html;

  // 1. スクリプトの中のデータ（キャラ・カード・段位）を、対訳表で英語にする。
  const translateJsonConst = (name, mapItem) => {
    const re = new RegExp(`^const ${name} = (\\[.*\\]);$`, "m");
    const m = re.exec(out);
    if (!m) throw new Error(`${name} のデータが見つかりません`);
    const list = JSON.parse(m[1]).map(mapItem);
    out = out.replace(re, () => `const ${name} = ${JSON.stringify(list)};`);
  };
  const tr = (text) => {
    const v = enData[text];
    if (v === undefined) throw new Error(`対訳表に無い文言です: ${text}`);
    return v;
  };
  translateJsonConst("CHARACTERS", (c) => {
    const full = tr(c.name); // 例: "Hiiragi, the Blossom Priestess"
    const [short, ...rest] = full.split(", ");
    const title = rest.join(", ");
    return { ...c, name: short, title: title ? title.charAt(0).toUpperCase() + title.slice(1) : "", short, skill: tr(c.skill), desc: tr(c.desc), quote: tr(c.quote) };
  });
  translateJsonConst("CARDS", (c) => ({ ...c, name: tr(c.name), type: TYPE_EN[c.type] ?? c.type, desc: tr(c.desc) }));
  translateJsonConst("RANKS", (r) => ({ ...r, name: tr(r.name) }));
  // キャラの技名は日本語版では「」で囲んでいる。英語は引用符にする。
  out = out.replace("textContent = `「${c.skill}」`;", 'textContent = `"${c.skill}"`;');

  // 2. 文言の置き換え。
  for (const [ja, en] of REPLACEMENTS) {
    if (!out.includes(ja)) throw new Error(`英語版の置き換え元が見つかりません（日本語版の文言が変わった？）: ${ja.slice(0, 60)}`);
    out = out.split(ja).join(en);
  }

  // 3. 検索・共有まわり（英語版の住所、言語の対応づけ）。
  const enUrl = `${siteUrl}/en/`;
  out = out
    .replace(`<link rel="canonical" href="${siteUrl}/" />`, `<link rel="canonical" href="${enUrl}" />`)
    .replace(`property="og:url" content="${siteUrl}/"`, `property="og:url" content="${enUrl}"`)
    .replace(`"url": "${siteUrl}/",`, `"url": "${enUrl}",`)
    .replace(`"url": "${gameUrl}/"`, `"url": "${gameUrl}/?lang=en"`);
  // ゲームへのリンクは、英語で開くよう lang=en を付ける。
  out = out.replaceAll(`href="${gameUrl}/"`, `href="${gameUrl}/?lang=en"`);
  // 日本語版への行き先をフッターに足す。
  out = out.replace(`<a href="${siteUrl}/en/" hreflang="en">English</a>`, `<a href="${siteUrl}/" hreflang="ja">日本語</a>`);

  // 4. 日本語が残っていないか確認する（説明の注記・コメントは除く）。
  const visible = out
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .map((l) => l.replace(/\s\/\/\s.*$/, ""))
    .join("\n");
  const left = [...new Set(visible.match(/[^\n<>"`]*[\u3040-\u30ff\u4e00-\u9fff][^\n<>"`]*/g) ?? [])].filter((x) => !x.includes("日本語") && !x.includes("简体中文") && !x.includes("繁體中文") && !x.includes("じゃんはい"));
  if (left.length > 0) throw new Error(`英語版に日本語が残っています:\n${left.slice(0, 15).join("\n")}`);
  return out;
}
