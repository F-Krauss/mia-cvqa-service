FROM node:20-slim AS build

WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y libvips libvips-dev && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY nest-cli.json ./
COPY tsconfig*.json ./

RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-slim

WORKDIR /usr/src/app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y libvips && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev

COPY --from=build /usr/src/app/dist ./dist

EXPOSE 8080

CMD ["node", "dist/src/main"]
