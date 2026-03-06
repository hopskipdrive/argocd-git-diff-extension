FROM golang:1.24-bookworm AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY main.go ./

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o server main.go

FROM gcr.io/distroless/static-debian12

WORKDIR /

COPY --from=builder /app/server .

EXPOSE 80

CMD ["/server"]
