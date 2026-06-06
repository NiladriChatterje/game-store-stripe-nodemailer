FROM node:jod-alpine3.21

# Update Alpine packages to reduce vulnerabilities

WORKDIR /app
COPY . .
# Create a new non-root user and add them to the sudo group
# -m: Create home directory
# -s /bin/bash: Set default shell
# -G sudo: Add to the sudo group
# -H: Do not create home directory (if you don't want it)
RUN addgroup -S sudo && \
    adduser -S payment -G sudo

RUN adduser payment wheel

RUN npm ci --force
# change User to payment
EXPOSE 5000

# Use tsx to run TypeScript directly; no build step needed
USER payment

CMD [ "npm","run","start" ]