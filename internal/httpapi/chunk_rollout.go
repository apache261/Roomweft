package httpapi

import (
	"fmt"
	"virtual-tour/internal/chunking"
)

// Production startup defaults to off until reviewed uploads are accepted.
// Spatial cells require a separate explicit rollout choice.
type ChunkRollout string

const (
	ChunkOff      ChunkRollout = "off"
	ChunkReviewed ChunkRollout = "reviewed"
	ChunkSpatial  ChunkRollout = "spatial"
)

func ParseChunkRollout(value string) (ChunkRollout, error) {
	if value == "" {
		return ChunkOff, nil
	}
	mode := ChunkRollout(value)
	if mode != ChunkOff && mode != ChunkReviewed && mode != ChunkSpatial {
		return "", fmt.Errorf("ASSET_CHUNK_STREAMING must be off, reviewed or spatial")
	}
	return mode, nil
}

type Options struct {
	ChunkStreaming ChunkRollout
	SplatSupport   SplatRollout
	SplatWalking   bool
	SplatStreaming bool
}

func (a *API) allowsChunks(m chunking.Manifest) bool {
	return (a.chunkStreaming == ChunkReviewed || a.chunkStreaming == ChunkSpatial) && m.Processor == chunking.ProcessorVersion && m.Schema == chunking.ManifestSchema && m.Partition.Policy == "reviewed-rooms" && (m.Partition.SpatialCellSize == 0 || a.chunkStreaming == ChunkSpatial)
}
