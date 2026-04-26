FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install
RUN npm install -g pm2

COPY . .

# Run the job using pm2 ecosystem file.
CMD ["pm2-runtime", "ecosystem.config.cjs"]
