FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package.json files to the working directory
COPY package*.json ./

# Install app dependencies
RUN yarn install

# Copy the source files
COPY . .

# Expose port 3000 for serving the app
EXPOSE 3000

# Command to run the app
CMD ["yarn", "start"]