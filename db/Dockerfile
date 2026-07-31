FROM postgres:17-alpine

# Baking the schema into the image means the Portainer stack needs no bind
# mount, so the compose file can be pasted straight into the web editor.
# Same rule as before: docker-entrypoint-initdb.d only runs against an empty
# data directory, so schema changes need a fresh pgdata volume.
COPY schema.sql /docker-entrypoint-initdb.d/schema.sql
