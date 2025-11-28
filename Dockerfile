# 1. Usa uma imagem Node.js leve como base
FROM node:20-slim

# 2. Instala as dependências do sistema necessárias para o Google Chrome
# O Chrome precisa de várias bibliotecas gráficas que não vêm no Linux padrão
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3. Configura variáveis de ambiente para o Puppeteer
# Isso diz: "Não baixe o Chromium padrão, use o Chrome que acabamos de instalar"
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# 4. Define o diretório de trabalho
WORKDIR /usr/src/app

# 5. Copia e instala dependências do projeto
COPY package*.json ./
RUN npm install

# 6. Copia o resto do código
COPY . .

# 7. Expõe a porta (O Render define a PORT automaticamente, mas é bom documentar)
EXPOSE 3000

# 8. Comando para iniciar
CMD [ "npm", "start" ]