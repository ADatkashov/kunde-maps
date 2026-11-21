FROM python:3.12-alpine
WORKDIR /app
COPY services/search/server.py /app/server.py
ENV PYTHONUNBUFFERED=1 PORT=10000 MAPS_SEARCH_DB=/data/kazakhstan-search.sqlite3
RUN addgroup -S maps && adduser -S -G maps maps && mkdir -p /data && chown maps:maps /data
USER maps
EXPOSE 10000
CMD ["python", "/app/server.py"]
