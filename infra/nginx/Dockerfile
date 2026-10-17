# Build context: the repo root (see docker-compose.prod.yml).

# Stage 1 — build every Angular app.
FROM node:24-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2 — the edge nginx, with each app's bundle at /usr/share/nginx/html/<app>.
FROM nginx:alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/portfolio/browser /usr/share/nginx/html/portfolio
COPY --from=build /app/dist/workout/browser   /usr/share/nginx/html/workout
COPY --from=build /app/dist/cards/browser     /usr/share/nginx/html/cards
COPY --from=build /app/dist/media/browser     /usr/share/nginx/html/media
COPY --from=build /app/dist/auth/browser      /usr/share/nginx/html/auth
COPY infra/nginx/nginx.conf /etc/nginx/conf.d/edge.conf
COPY infra/nginx/snippets/  /etc/nginx/snippets/
EXPOSE 80 443
