FROM node:jod-alpine3.21
WORKDIR /app
COPY . .
RUN npm install
RUN addgroup -S searchGroup && adduser -S searchUser -G searchGroup
USER searchUser
EXPOSE 5005
CMD [ "npm", "run", "start" ]