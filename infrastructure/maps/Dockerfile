FROM nginx:1.27-alpine
COPY apps/web/ /srv/kunde-web/
COPY infrastructure/maps/nginx.conf /etc/nginx/conf.d/default.conf
COPY infrastructure/maps/40-configure-tiles.sh /docker-entrypoint.d/40-configure-tiles.sh
RUN chmod +x /docker-entrypoint.d/40-configure-tiles.sh && mkdir -p /srv/kunde-tiles && printf '{"styleUrl":"/style.json"}\n' > /srv/kunde-web/config.json
EXPOSE 80
