# 使い方: CLIP_LANG=zh bash batch-lang.sh <作業フォルダ> <caps.json>  （puppeteer-core入りの作業フォルダ/pp が必要。Vite(5199)は先に起動）
SP="$1"; CAPS="$2"; HERE="$(cd "$(dirname "$0")" && pwd)"
cp "$HERE/rec.mjs" "$HERE/build.mjs" "$SP/pp/"   # puppeteer-core は作業フォルダ側にあるため、そこで実行する
mkdir -p "$SP/out" "$SP/mp4-$CLIP_LANG"
for id in deagari jin nyanjiro ren kaede koji koki mirai nannan sena subaru takaharu zeno hiiragi kagerou masato nagi runa toki; do
  mode=""; case $id in deagari|jin|nyanjiro|ren) mode=riichi;; esac
  rm -rf "$SP/out/$id" 2>/dev/null
  (cd "$SP/pp" && timeout 170 node rec.mjs $id "$SP/out/$id" $mode > "$SP/out/$id.log" 2>&1)
  if grep -q '"ok":true' "$SP/out/$id.log"; then (cd "$SP/pp" && node build.mjs $id "$SP/out/$id" "$CAPS" "$SP/mp4-$CLIP_LANG/$id.mp4" >> "$SP/out/$id.log" 2>&1) && echo "$id OK" || echo "$id BUILD-FAIL"; else echo "$id REC-FAIL"; fi
done
echo DONE
