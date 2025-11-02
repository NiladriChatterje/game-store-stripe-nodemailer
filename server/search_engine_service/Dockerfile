FROM node:jod-alpine3.21
WORKDIR /app
COPY . .
RUN apk update \
    && apk upgrade --no-cache
RUN npm install
RUN addgroup -S searchGroup && adduser -S searchUser -G searchGroup
USER searchUser
EXPOSE 5005
CMD [ "npm", "run", "start" ]