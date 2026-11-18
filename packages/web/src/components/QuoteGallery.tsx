import { useState } from "react";
import { CHARACTERS } from "@majyan/core";
import { useT } from "../i18n/index.js";

/**
 * 全キャラの勝利台詞（対局で1位になった時に出る台詞）を並べて見返すための
 * 確認用ページ（URLに ?quote-gallery を付けて開く。キャラ選択画面の
 * デバッグモードの下のボタンからも開ける）。キャラデータ(characters.ts)を
 * そのまま読むので、台詞を書き換えればこのページにもすぐ反映される。
 */
export function QuoteGallery() {
  const t = useT();
  const [query, setQuery] = useState("");
  const all = Object.values(CHARACTERS);
  const q = query.trim().toLowerCase();
  const shown = q
    ? all.filter((c) => [c.name, c.skill.name, c.winQuote, c.id].some((text) => text.toLowerCase().includes(q)))
    : all;

  return (
    <div className="quote-gallery">
      <header className="quote-gallery__header">
        <h1>{t("matchSetup.t3")}</h1>
        <input
          className="quote-gallery__search"
          type="search"
          placeholder={t("quoteGallery.t1")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="quote-gallery__count">{t("quoteGallery.t3", { length: shown.length, v1: all.length })}</span>
      </header>
      <div className="quote-gallery__grid">
        {shown.map((c) => (
          <article key={c.id} className="quote-gallery__card">
            <img className="quote-gallery__avatar" src={c.avatar} alt="" />
            <div>
              <div className="quote-gallery__name">
                {c.name}
                <span className="quote-gallery__skill">{t("hand.t21", { name: c.skill.name })}</span>
              </div>
              <p className="quote-gallery__quote">「{c.winQuote}」</p>
            </div>
          </article>
        ))}
      </div>
      {shown.length === 0 && <p className="quote-gallery__empty">{t("quoteGallery.t2")}</p>}
    </div>
  );
}
