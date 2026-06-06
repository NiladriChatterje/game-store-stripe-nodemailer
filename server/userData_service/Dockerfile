FROM node:jod-alpine3.21

WORKDIR /app

COPY . .

RUN npm install

RUN npm run build

#Creating a non-root user
RUN addgroup -S userDataGroup && adduser -S userData -G userDataGroup

# change User to userData
USER userData

CMD ["node", "dist/index.js"]
