FROM node:jod-alpine3.21
WORKDIR /app
COPY . .
RUN apk update \
    && apk upgrade --no-cache
RUN npm install
RUN addgroup -S productGroup && adduser -S productUser -G productGroup
USER productUser
EXPOSE 5002
CMD [ "npm", "run", "start" ]