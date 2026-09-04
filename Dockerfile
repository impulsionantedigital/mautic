FROM mautic/mautic:7.1.1-apache

# Define o diretório de trabalho padrão do Apache
WORKDIR /var/www/html

# Copia os arquivos do seu repositório para o container
COPY . /var/www/html

# Garante permissões adequadas para o usuário do Apache (www-data)
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html/var/cache /var/www/html/var/logs 2>/dev/null || true

# Mantém o entrypoint e comando padrão da imagem base
