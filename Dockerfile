# syntax=docker/dockerfile:1.7

# Estágio de desenvolvimento
FROM node:22-slim AS development

WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

COPY docker-entrypoint.sh /usr/local/bin/catalogo-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/catalogo-entrypoint.sh && chmod +x /usr/local/bin/catalogo-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/catalogo-entrypoint.sh"]

CMD ["npm", "run", "dev", "--", "--host"]

# Estágio de build para produção
FROM node:22-slim AS builder

WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

RUN npm run build

# Estágio de produção
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

# API de producao: migrations executadas pelo entrypoint antes do servidor.
FROM node:22-slim AS api-production

WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json docker-entrypoint.sh ./

COPY docker-entrypoint.sh /usr/local/bin/catalogo-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/catalogo-entrypoint.sh && chmod +x /usr/local/bin/catalogo-entrypoint.sh

ENV NODE_ENV=production
ENV RUN_PRISMA_MIGRATIONS=true

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/catalogo-entrypoint.sh"]
CMD ["npm", "run", "api:start"]
