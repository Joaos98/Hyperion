# Hyperion, self-hosted: one image, one process, one SQLite file.
#
#   docker build -t hyperion .
#   docker run -p 8080:8080 -v hyperion:/data hyperion
#
# The volume is the whole of the deployment's state. Nothing else in the image is worth
# keeping, and exporting your data from Settings is the backup for anyone who would
# rather not think about volumes at all.

# SQLite is a C library, so somewhere it has to be compiled. Here, and only here — the
# image that ends up running carries the result and not the toolchain.
FROM node:22-bookworm-slim AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /hyperion
COPY package.json package-lock.json ./

FROM deps AS build
RUN npm ci
COPY . .
RUN npm run build:self-hosted

FROM deps AS runtime
RUN npm ci --omit=dev && npm cache clean --force

# Only what it takes to run: the built app, the bundled server, and the one dependency
# that is not bundled because it is not JavaScript.
FROM node:22-bookworm-slim AS hyperion
ENV NODE_ENV=production
WORKDIR /hyperion
COPY package.json ./
COPY --from=runtime /hyperion/node_modules ./node_modules
COPY --from=build /hyperion/dist ./dist
COPY --from=build /hyperion/dist-server ./dist-server

ENV HYPERION_DATABASE=/data/hyperion.db
ENV HYPERION_APP=/hyperion/dist
ENV PORT=8080

RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "dist-server/main.js"]
