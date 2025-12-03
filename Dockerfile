FROM node:18-slim

# 1. Instala dependências do sistema necessárias para o Puppeteer e Chrome
# O comando abaixo instala o Chrome Stable (que traz todas as libs junto) e fontes necessárias
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 2. Define diretório de trabalho
WORKDIR /usr/src/app

# 3. Copia os arquivos de dependência
COPY package*.json ./

# 4. Instala as dependências do projeto
# O Puppeteer vai baixar o Chromium dele, mas usará as libs que instalamos acima
RUN npm install



# 5. Copia o resto do código
COPY . .

RUN rm -rf .wwebjs_auth .wwebjs_cache

# 6. Variáveis de ambiente para o Puppeteer não reclamar
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
ENV PUPPETEER_ARGS='--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage'

# 7. Expõe a porta (Ajuste se sua porta for diferente de 3003)
EXPOSE 3003

# 8. Comando de inicialização
CMD [ "npm", "run", "dev" ]