FROM nginx:1.27-alpine
COPY apps/web/ /srv/kunde-web/
COPY infrastructure/maps/nginx.conf /etc/nginx/conf.d/default.conf
RUN mkdir -p /srv/kunde-tiles && printf '{"styleUrl":"/style.json"}\n' > /srv/kunde-web/config.json
EXPOSE 80
