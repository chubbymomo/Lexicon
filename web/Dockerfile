# Lexicon web app and API.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Installing also generates the database client, which needs the schema.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
# The build loads the database module but never connects; any well-formed URL will do.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run build && rm -rf .next/cache

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
# Apply migrations and load the curriculum (both safe to repeat), then serve.
CMD ["sh", "-c", "npm run db:migrate && exec npx next start -H 0.0.0.0 -p 3000"]
