FROM oven/bun:1 AS base
WORKDIR /app

RUN apt-get update && apt-get install -y \
  libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
  libasound2 libatspi2.0-0 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lockb* ./
RUN bun install --production

RUN npx playwright install chromium --with-deps

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "server.ts"]
