FROM golang:1.23.1 as builder

# Make static bundle to work with scratch/distroless
ENV CGO_ENABLED=0

WORKDIR /build

COPY go.mod go.sum ./

RUN go mod download

COPY . .

ARG TARGETOS=linux TARGETARCH=amd64 TARGETVARIANT=v7

RUN export GOOS=${TARGETOS} GOARCH=${TARGETARCH} GOARM=${TARGETVARIANT#v} && \
  go build -trimpath -v -o /out/autoscaler main.go

# Use distroless as minimal base image to package the autoscaler binary
# Includes e.g. certificates which would be needed to added to scratch
# see https://github.com/GoogleContainerTools/distroless
FROM gcr.io/distroless/static:nonroot

WORKDIR /

COPY --from=builder /out/autoscaler .

USER 65532:65532

ENTRYPOINT ["/autoscaler"]
