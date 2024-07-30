FROM node:20.16.0-bullseye-slim

# Create app directory
WORKDIR /app

RUN apt-get update \
    && apt-get install -y python zlib1g-dev libxml2-dev libsqlite3-dev libpq-dev libxmlsec1-dev make g++

# Copy package.json files to the working directory
COPY package.json .
COPY yarn.lock .
ADD prisma/schema.prisma prisma/schema.prisma
RUN corepack enable

# Install app dependencies
RUN yarn

# Copy the source files
COPY . .

# Expose port 3000 for serving the app
EXPOSE 3000

# Command to run the app
CMD ["yarn", "start"]