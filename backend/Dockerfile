ARG BUILDPLATFORM=linux/arm64
FROM --platform=$BUILDPLATFORM 564365460806.dkr.ecr.us-east-2.amazonaws.com/docker-hub/library/golang:1.24-bookworm AS builder

ARG TARGETOS=linux
ARG TARGETARCH

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY main.go ./

RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -a -installsuffix cgo -o server main.go

FROM --platform=$TARGETPLATFORM gcr.io/distroless/static-debian12

WORKDIR /

COPY --from=builder /app/server .

EXPOSE 80

CMD ["/server"]
