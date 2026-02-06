FROM node:25-alpine3.22

WORKDIR /app

COPY . .

RUN apk update && apk upgrade

RUN npm install

RUN npm run build

RUN adduser -S kafkaConsumers && adduser kafkaConsumers wheel

USER kafkaConsumers

CMD ["npm", "run", "start"]

