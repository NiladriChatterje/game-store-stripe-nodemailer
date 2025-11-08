FROM node:jod-alpine3.21

WORKDIR /app

COPY ./ ./

RUN apk update && \
    apk upgrade --no-cache

RUN npm install
#Creating a non-root user
RUN addgroup -S paymentGroup && adduser -S payment -G paymentGroup

# change User to payment
USER payment

EXPOSE 5000

CMD ["npm","run","start"]