FROM mcr.microsoft.com/playwright:v1.52.0-noble

RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && curl -fsSL https://bun.sh/install | bash \
  && apt-get remove -y curl unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app
COPY package.json package.json
RUN bun install --production
COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "server.ts"]