FROM node:25.0.0-alpine3.20

WORKDIR /app

COPY ./ ./

RUN apk update && \
    apk upgrade --no-cache

RUN npm install
#Creating a non-root user
RUN addgroup -S paymentGroup && adduser -S payment -G paymentGroup

# change User to payment
USER payment

CMD ["npm","run","start"]