# Routing API: our authenticated Python front + a localhost-only Valhalla process (Valhalla has no authentication of its own).
# Build context = repository root (shares protection.py / apikeys.py / provision_index.py with the Search API).
FROM ghcr.io/gis-ops/docker-valhalla/valhalla:latest
USER root
RUN command -v python3 >/dev/null && python3 --version
WORKDIR /app
COPY services/routing/route_server.py services/routing/polyline.py services/routing/provision_graph.py /app/
COPY services/search/protection.py services/search/apikeys.py services/search/provision_index.py /app/
ENV PYTHONUNBUFFERED=1 PORT=10000 MAPS_ROUTING_GRAPH=/tmp/valhalla/valhalla-tiles.tar
RUN useradd --system --no-create-home maps && mkdir -p /tmp/valhalla && chown maps /tmp/valhalla
USER maps
EXPOSE 10000
ENTRYPOINT []
CMD ["sh", "-c", "python3 /app/provision_graph.py && exec python3 /app/route_server.py"]
