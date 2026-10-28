ARG BUILDPLATFORM=linux/arm64
FROM --platform=$BUILDPLATFORM 564365460806.dkr.ecr.us-east-2.amazonaws.com/docker-hub/library/golang:1.26.10-bookworm AS builder

ARG TARGETOS=linux
ARG TARGETARCH=arm64

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY main.go ./

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -a -installsuffix cgo -o server main.go
RUN go version ./server

FROM --platform=$BUILDPLATFORM gcr.io/distroless/static-debian12:nonroot-arm64 AS runtime-base

FROM 564365460806.dkr.ecr.us-east-2.amazonaws.com/docker-hub/library/python:3.13.7-slim AS certificates
COPY --from=runtime-base /etc/ssl/certs/ca-certificates.crt /tmp/original.crt
COPY filter_ca_bundle.py /tmp/filter_ca_bundle.py
RUN python3 /tmp/filter_ca_bundle.py /tmp/original.crt /tmp/ca-certificates.crt

FROM runtime-base
COPY --from=certificates /tmp/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

WORKDIR /

COPY --from=builder /app/server .

EXPOSE 8080

CMD ["/server"]
