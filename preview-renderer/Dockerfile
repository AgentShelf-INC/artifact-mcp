# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Neil Blackman
FROM mcr.microsoft.com/playwright:v1.61.0-noble

ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PORT=3000 HOME=/tmp/pwuser
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && chown -R pwuser:pwuser /app
COPY --chown=pwuser:pwuser server.js worker.js smoke.js ./

USER pwuser
EXPOSE 3000
CMD ["node", "server.js"]
