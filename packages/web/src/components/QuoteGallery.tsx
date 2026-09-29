import { useState } from "react";
import { CHARACTERS } from "@majyan/core";

/**
 * 全キャラの勝利台詞（対局で1位になった時に出る台詞）を並べて見返すための
 * 確認用ページ（URLに ?quote-gallery を付けて開く。キャラ選択画面の
 * デバッグモードの下のボタンからも開ける）。キャラデータ(characters.ts)を
 * そのまま読むので、台詞を書き換えればこのページにもすぐ反映される。
 */
export function QuoteGallery() {
  const [query, setQuery] = useState("");
  const all = Object.values(CHARACTERS);
  const q = query.trim().toLowerCase();
  const shown = q
    ? all.filter((c) => [c.name, c.skill.name, c.winQuote, c.id].some((text) => text.toLowerCase().includes(q)))
    : all;

  return (
    <div className="quote-gallery">
      <header className="quote-gallery__header">
        <h1>勝利台詞一覧</h1>
        <input
          className="quote-gallery__search"
          type="search"
          placeholder="キャラ名・技名・台詞で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="quote-gallery__count">
          {shown.length} / {all.length} キャラ
        </span>
      </header>
      <div className="quote-gallery__grid">
        {shown.map((c) => (
          <article key={c.id} className="quote-gallery__card">
            <img className="quote-gallery__avatar" src={c.avatar} alt="" />
            <div>
              <div className="quote-gallery__name">
                {c.name}
                <span className="quote-gallery__skill">必殺技: {c.skill.name}</span>
              </div>
              <p className="quote-gallery__quote">「{c.winQuote}」</p>
            </div>
          </article>
        ))}
      </div>
      {shown.length === 0 && <p className="quote-gallery__empty">該当するキャラがいません。</p>}
    </div>
  );
}
