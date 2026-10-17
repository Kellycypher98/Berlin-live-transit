# Backend only: live data, journeys, tracking (the React app is hosted on Netlify).
# Runs on AWS Lightsail via deploy/docker-compose.yml (or any container host with 2 GB+ memory).
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
# --ignore-scripts: skip the postinstall that installs the React app's packages
RUN npm ci --omit=dev --ignore-scripts
COPY server.js ./
COPY lib ./lib
# The VBB timetable is downloaded into data/ on start
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=180s CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "server.js"]
