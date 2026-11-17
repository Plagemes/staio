# Servizio di estrazione dei video. Nessuna dipendenza npm: solo Node, ffmpeg e yt-dlp (eseguibile ufficiale).
# Costruzione (dalla cartella worker/video):  docker build -t staio-video .
FROM node:22-bookworm-slim

# ffmpeg dal sistema; curl serve solo qui sotto per scaricare yt-dlp e viene tolto subito dopo.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp: eseguibile ufficiale, con controllo della somma SHA-256 pubblicata insieme alla versione.
# Va aggiornato spesso (le piattaforme cambiano): ricostruisci l'immagine senza cache per prendere l'ultima versione:
#   docker build --no-cache -t staio-video .
ARG YTDLP_BASE=https://github.com/yt-dlp/yt-dlp/releases/latest/download
RUN set -eux; \
    cd /tmp; \
    curl -fsSLO "$YTDLP_BASE/yt-dlp_linux"; \
    curl -fsSLO "$YTDLP_BASE/SHA2-256SUMS"; \
    grep ' yt-dlp_linux$' SHA2-256SUMS | sha256sum -c -; \
    install -m 0755 yt-dlp_linux /usr/local/bin/yt-dlp; \
    rm -f yt-dlp_linux SHA2-256SUMS; \
    apt-get purge -y --auto-remove curl

WORKDIR /app
COPY package.json server.mjs ./
COPY src ./src

# Utente senza privilegi. La cartella dei temporanei è sua e solo sua.
RUN mkdir -p /tmp/staio-video && chown node:node /tmp/staio-video && chmod 700 /tmp/staio-video
USER node

# In un contenitore il servizio ascolta su tutte le interfacce; è il comando «docker run» a decidere cosa pubblicare
# (vedi README: di norma solo su 127.0.0.1 o dietro un proxy con https).
ENV HOST=0.0.0.0 \
    PORT=8787 \
    STAIO_VIDEO_TMP=/tmp/staio-video \
    NODE_ENV=production
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/salute').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
