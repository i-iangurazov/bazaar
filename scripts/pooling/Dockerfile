FROM alpine:3.22
RUN apk add --no-cache pgbouncer postgresql16-client
USER nobody
ENTRYPOINT ["pgbouncer"]
