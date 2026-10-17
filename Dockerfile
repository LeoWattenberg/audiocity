FROM node:26.5.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# An optional build secret supports environments with an HTTPS inspection CA.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm install --global npm@12.0.1 && npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:26.5.0-bookworm-slim
LABEL org.opencontainers.image.title="Audiocity" \
    org.opencontainers.image.source="https://github.com/mindscaper-org/audiocity" \
    org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production AUDIOCITY_DATA_DIR=/data AUDIOCITY_HOST=0.0.0.0 AUDIOCITY_PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node LICENSE NOTICE.md ./
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
