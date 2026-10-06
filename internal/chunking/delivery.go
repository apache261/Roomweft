package chunking

import (
	"errors"
	"fmt"
	"net/url"
)

// Delivery DTOs carry scoped, renewable URLs separately from durable descriptors.
// Scope authorization and bounded/on-demand signing are Phase 4 responsibilities.
type DeliveredPayload struct {
	URL          string `json:"url"`
	SHA256       string `json:"sha256"`
	Bytes        int64  `json:"bytes"`
	TextureBytes int64  `json:"texture_rgba8_bytes"`
	MaxTexture   int    `json:"max_texture"`
}
type DeliveredChunk struct {
	Chunk
	Variants map[string]DeliveredPayload `json:"variants"`
}
type DeliveredDependency struct {
	ResourceDependency
	Variants map[string]DeliveredPayload `json:"variants"`
}
type DeliveredIndex struct {
	ExactIndex
	Payload DeliveredPayload `json:"payload"`
}
type DeliveredManifest struct {
	Manifest
	Chunks       []DeliveredChunk      `json:"chunks"`
	Dependencies []DeliveredDependency `json:"dependencies"`
	Navigation   DeliveredIndex        `json:"navigation"`
	Occlusion    DeliveredIndex        `json:"occlusion"`
}

// Validate checks the delivered structure by substituting anonymous descriptors;
// these keys exist only during validation and are never used as resource identity.
func (d DeliveredManifest) Validate() error {
	m := d.Manifest
	m.Chunks = []Chunk{}
	m.Dependencies = []ResourceDependency{}
	sequence := 0
	convert := func(p DeliveredPayload) (Payload, error) {
		parsed, err := url.Parse(p.URL)
		if err != nil || len(p.URL) > 16384 || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.Fragment != "" {
			return Payload{}, errors.New("invalid signed descriptor URL")
		}
		sequence++
		return Payload{Key: fmt.Sprintf("descriptor-%d", sequence), SHA256: p.SHA256, Bytes: p.Bytes, TextureBytes: p.TextureBytes, MaxTexture: p.MaxTexture}, nil
	}
	variants := func(v map[string]DeliveredPayload) (map[string]Payload, error) {
		result := map[string]Payload{}
		for tier, p := range v {
			converted, err := convert(p)
			if err != nil {
				return nil, err
			}
			result[tier] = converted
		}
		return result, nil
	}
	for _, c := range d.Chunks {
		chunk := c.Chunk
		v, err := variants(c.Variants)
		if err != nil {
			return err
		}
		chunk.Variants = v
		m.Chunks = append(m.Chunks, chunk)
	}
	for _, d := range d.Dependencies {
		dependency := d.ResourceDependency
		v, err := variants(d.Variants)
		if err != nil {
			return err
		}
		dependency.Variants = v
		m.Dependencies = append(m.Dependencies, dependency)
	}
	m.Navigation = d.Navigation.ExactIndex
	m.Occlusion = d.Occlusion.ExactIndex
	var err error
	m.Navigation.Payload, err = convert(d.Navigation.Payload)
	if err != nil {
		return err
	}
	m.Occlusion.Payload, err = convert(d.Occlusion.Payload)
	if err != nil {
		return err
	}
	return m.Validate()
}
