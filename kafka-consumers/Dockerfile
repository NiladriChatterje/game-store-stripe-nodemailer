FROM node:25-alpine3.22

WORKDIR /app

COPY . .

RUN apk update && apk upgrade

RUN npm ci

RUN addgroup -S kafkaConsumers && adduser -S kafkaConsumers -G kafkaConsumers

USER kafkaConsumers

CMD ["npm", "run", "delete","&&","npm","run","start"]

