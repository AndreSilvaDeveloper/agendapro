# 1. Usa uma imagem Node.js leve como base
FROM node:20-slim

# 2. Instala as dependências (git incluso)
RUN apt-get update \
    && apt-get install -y wget gnupg git \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# === A CORREÇÃO MÁGICA AQUI ===
# Força o git a usar HTTPS mesmo se pedirem SSH
RUN git config --global url."https://github.com/".insteadOf git@github.com:
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/
RUN git config --global url."https://github.com/".insteadOf git://github.com/


# 3. Configura variáveis de ambiente
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# 4. Define o diretório de trabalho
WORKDIR /usr/src/app

# 5. Copia e instala dependências
COPY package*.json ./

RUN rm -f package-lock.json && npm cache clean --force && npm install

RUN npm install

# 6. Copia o resto do código
COPY . .

EXPOSE 3000
CMD [ "npm", "start" ]