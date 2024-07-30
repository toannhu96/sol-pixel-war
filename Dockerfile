FROM node:20-alpine

# Create app directory
WORKDIR /app

RUN apk add --update --no-cache \
    make \
    g++ \
    jpeg-dev \
    cairo-dev \
    giflib-dev \
    pango-dev \
    libtool \
    autoconf \
    automake

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