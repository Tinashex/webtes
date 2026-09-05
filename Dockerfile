FROM node:20-slim

WORKDIR /app

# Install deps for node-webpmux and other native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 8000

# Save sessions so bot doesn't logout every restart
VOLUME ["/app/0"]

CMD ["npm", "start"]
