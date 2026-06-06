FROM node:jod-alpine3.21
WORKDIR /app
COPY . .
RUN npm install
RUN addgroup -S productGroup && adduser -S productUser -G productGroup
USER productUser
EXPOSE 5002
CMD [ "npm", "run", "start" ]