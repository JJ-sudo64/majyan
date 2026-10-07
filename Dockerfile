# ネット対戦サーバー（画面の配信込み）を1つのコンテナで動かす。
#   docker build -t majyan .
#   docker run -p 8787:8787 majyan        → http://localhost:8787
# 公開する時は ALLOWED_ORIGINS に自分のURL（例: https://example.com）を入れる。
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
COPY packages/server/package.json packages/server/
RUN npm ci

COPY packages ./packages
RUN npm run build -w packages/web

ENV NODE_ENV=production PORT=8787
# アカウント・雀玉などのDBと、その定期バックアップ（backups/）。コンテナを作り直しても消えないよう
# ボリュームに置く（docker run -v majyan-data:/app/packages/server/data ...）。
VOLUME /app/packages/server/data
EXPOSE 8787
CMD ["npm", "run", "start", "-w", "packages/server"]
