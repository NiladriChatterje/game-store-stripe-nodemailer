FROM node:22-alpine

# Update Alpine packages to reduce vulnerabilities

WORKDIR /app
COPY . .
# Create a new non-root user and add them to the sudo group
# -m: Create home directory
# -s /bin/bash: Set default shell
# -G sudo: Add to the sudo group
# -H: Do not create home directory (if you don't want it)
RUN addgroup -S sudo && \
 adduser -S production -G sudo

 RUN apk update \
     && apk upgrade --no-cache 

RUN npm install
# change User to production
USER production

    
EXPOSE 5004
CMD [ "npm","run","start" ]