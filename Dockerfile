# Hypersense – statischer Node-Server ohne Abhängigkeiten
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=5180 \
    HOST=0.0.0.0 \
    MUSIC_DIR=/music

WORKDIR /app
COPY server.js package.json ./
# Spiel inklusive Grafiken (public/assets) und Explosions-Samples (public/sfx)
COPY public ./public

# Songs kommen per Volume nach /music
RUN mkdir -p /music && chown node:node /music
USER node

EXPOSE 5180
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz >/dev/null || exit 1

CMD ["node", "server.js"]
