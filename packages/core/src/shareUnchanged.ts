/**
 * nextのうち、prevと中身が同じ部分はprevのオブジェクト・配列をそのまま使い回した
 * 値を返す（構造の共有）。
 *
 * ネット対戦ではサーバーから状態がJSONで届くため、何も変わっていない牌や河まで
 * 毎回新しいオブジェクトになる。画面側の演出には「オブジェクトが別物になったら
 * 変化があった」とみなすもの（Reactのeffectの依存など）があり、ローカル対戦では
 * 起きない演出の再生し直しが起きてしまう。届いた状態をこれに通すと、ローカル対戦と
 * 同じく「変わった所だけが新しいオブジェクト」になる。
 * 中身が全く同じならprevそのものを返す。
 */
export function shareUnchanged<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (typeof prev !== "object" || typeof next !== "object" || prev === null || next === null) return next;
  if (Array.isArray(prev) !== Array.isArray(next)) return next;

  if (Array.isArray(next)) {
    const p = prev as unknown[];
    let same = p.length === next.length;
    const out = next.map((item, i) => {
      const shared = shareUnchanged(p[i], item);
      if (shared !== p[i]) same = false;
      return shared;
    });
    return (same ? p : out) as T;
  }

  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const keys = Object.keys(n);
  let same = keys.length === Object.keys(p).length;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const shared = shareUnchanged(p[key], n[key]);
    if (!(key in p) || shared !== p[key]) same = false;
    out[key] = shared;
  }
  return (same ? p : out) as T;
}
