# Zebra Label Printer — Docker image
# USB printer passthrough: mount the host CUPS socket and USB device(s).
#
# Build:
#   docker build -t zebra-label-printer .
#
# Run (CUPS mode — recommended):
#   docker run -d --name zebra-label \
#     -p 3420:3420 \
#     -v /var/run/cups/cups.sock:/var/run/cups/cups.sock \
#     -v /home/xanderr/clawd/dev/projects/zebra-label-printer/data:/app/data \
#     zebra-label-printer
#
# Run (USB passthrough — alternative):
#   docker run -d --name zebra-label \
#     -p 3420:3420 \
#     --device /dev/bus/usb/001/007 \
#     -v /home/xanderr/clawd/dev/projects/zebra-label-printer/data:/app/data \
#     zebra-label-printer

FROM node:24-alpine

# Install CUPS client (for lp/lpstat commands)
RUN apk add --no-cache cups-client

WORKDIR /app

# Copy built JS
COPY dist/ ./dist/
COPY package.json package-lock.json ./
COPY data/ ./data/

# Install only production deps
RUN npm ci --omit=dev

ENV PORT=3420
ENV ZEBRA_PRINTER=""
ENV ZEBRA_DB_PATH=/app/data/zebra-label-printer.db
ENV ZEBRA_API_KEY=""

EXPOSE 3420

CMD ["node", "dist/server/index.js"]
