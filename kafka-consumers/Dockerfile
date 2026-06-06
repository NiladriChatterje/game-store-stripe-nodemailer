FROM node:25-alpine3.22

WORKDIR /app

COPY . .

RUN npm ci

RUN addgroup -S kafkaConsumers && adduser -S kafkaConsumers -G kafkaConsumers

USER kafkaConsumers

CMD ["sh", "-c", "npm run delete; npm run start"]

