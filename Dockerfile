# syntax=docker/dockerfile:1.7

# Estágio de desenvolvimento
FROM node:22-slim AS development

WORKDIR /app

COPY package*.json ./

RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]

CMD ["npm", "run", "dev", "--", "--host"]

# Estágio de build para produção
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./

RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

RUN npm run build

# Estágio de produção
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
