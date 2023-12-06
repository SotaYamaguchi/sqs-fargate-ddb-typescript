FROM node:18-buster-slim

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

ENTRYPOINT ["node", "main.js"]
