FROM node:jod-alpine3.21

WORKDIR /app

# Update Alpine packages to reduce vulnerabilities
RUN apk update && apk upgrade --no-cache

COPY . .

RUN npm ci --force

RUN npm run build

EXPOSE 4000

# Create a non-root user for security (optional but recommended, following payment_service pattern)
RUN addgroup -S sudo && \
    adduser -S sseuser -G sudo

USER sseuser

CMD [ "npm", "run", "start" ]
