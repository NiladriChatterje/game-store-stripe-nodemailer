FROM node:jod-alpine3.21

WORKDIR /app

COPY . .

RUN npm ci --force

EXPOSE 4000

# Create a non-root user for security
RUN addgroup -S sudo && \
    adduser -S sseuser -G sudo

USER sseuser

CMD [ "npm", "run", "dev" ]