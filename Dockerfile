# Estágio de desenvolvimento
FROM node:22-alpine AS development

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]

CMD ["npm", "run", "dev", "--", "--host"]

# Estágio de build para produção
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

# Estágio de produção
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
