FROM python:3.12-alpine
WORKDIR /app
COPY services/search/server.py /app/server.py
COPY services/search/protection.py /app/protection.py
COPY services/search/apikeys.py /app/apikeys.py
COPY services/search/textnorm.py /app/textnorm.py
COPY services/search/categories.py /app/categories.py
COPY services/search/places.py /app/places.py
COPY services/search/provision_index.py /app/provision_index.py
ENV PYTHONUNBUFFERED=1 PORT=10000 MAPS_SEARCH_DB=/data/kazakhstan-search.sqlite3
RUN addgroup -S maps && adduser -S -G maps maps && mkdir -p /data && chown maps:maps /data
USER maps
EXPOSE 10000
CMD ["sh", "-c", "python /app/provision_index.py && exec python /app/server.py"]
