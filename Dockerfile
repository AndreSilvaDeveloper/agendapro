# 1. Base Node.js
FROM node:20-slim

# 2. Instala dependências do sistema (Chrome + Git + Bibliotecas)
RUN apt-get update \
    && apt-get install -y wget gnupg git ca-certificates \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3. Variáveis do Puppeteer

WORKDIR /usr/src/app

# 4. Instalação das dependências do Node
COPY package.json ./
# IMPORTANTE: Não copiamos o package-lock.json aqui para forçar uma instalação limpa
# IMPORTANTE 2: --no-git-tag-version evita problemas com tags do git
RUN npm install --omit=optional

# 5. Copia o resto do projeto
COPY . .

EXPOSE 3000
CMD [ "npm", "start" ]