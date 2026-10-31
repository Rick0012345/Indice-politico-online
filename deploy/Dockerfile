FROM node:22-slim AS validation
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run lint && npm run build

FROM nginx:alpine AS web
COPY --from=validation /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

FROM node:22-slim AS api
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "api:start"]
