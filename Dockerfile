# Zebra Label Printer — Docker image
# USB printer passthrough: mount the host CUPS socket and USB device(s).
#
# Build:
#   docker build -t zebra-label-printer .
#
# Requires a local `npm run build` first: this image ships the compiled dist/.
#
# Mount a host directory at /app/data to keep the database (print history, printer
# configuration, settings) outside the container.
#
# Run (CUPS mode — recommended):
#   docker run -d --name zebra-label \
#     -p 3420:3420 \
#     -v /var/run/cups/cups.sock:/var/run/cups/cups.sock \
#     -v "$PWD/data:/app/data" \
#     zebra-label-printer
#
# Run (USB passthrough — alternative):
#   docker run -d --name zebra-label \
#     -p 3420:3420 \
#     --device /dev/bus/usb/001/007 \
#     -v "$PWD/data:/app/data" \
#     zebra-label-printer

FROM node:24-alpine

# Install CUPS client (for lp/lpstat commands)
RUN apk add --no-cache cups-client

WORKDIR /app

# Copy built JS
COPY dist/ ./dist/
COPY package.json package-lock.json ./

# Drizzle migrations, applied automatically on first DB access
COPY drizzle/ ./drizzle/

# Install only production deps
RUN npm ci --omit=dev

# The database lives here. Declared as a volume so it survives `docker rm` and so
# an image rebuild can't carry a stale database in a layer. This used to be
# `COPY data/ ./data/`, which baked the build host's own database into the image —
# and failed outright on a fresh clone, since data/ is gitignored and untracked.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=3420
ENV ZEBRA_PRINTER=""
ENV ZEBRA_DB_PATH=/app/data/zebra-label-printer.db
ENV ZEBRA_API_KEY=""

EXPOSE 3420

CMD ["node", "dist/server/index.js"]
