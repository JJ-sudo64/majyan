SP="$1"; cd "$SP/pp"
for id in deagari jin nyanjiro ren kaede koji koki mirai nannan sena subaru takaharu zeno; do
  mode=""; case $id in deagari|jin|nyanjiro|ren) mode=riichi;; esac
  sleep 1; rm -rf "$SP/out/$id" 2>/dev/null
  timeout 150 node rec.mjs $id "$SP/out/$id" $mode > "$SP/out/$id.log" 2>&1
  if grep -q '"ok":true' "$SP/out/$id.log"; then node build.mjs $id "$SP/out/$id" "$SP/caps.json" "$SP/mp4/$id.mp4" >> "$SP/out/$id.log" 2>&1 && echo "$id OK" || echo "$id BUILD-FAIL"; else echo "$id REC-FAIL"; fi
  sleep 1; rm -rf "$SP/out/$id" 2>/dev/null
done
echo DONE
