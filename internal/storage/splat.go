package storage

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"github.com/minio/minio-go/v7"
	"io"
	"math"
	"os"
	"time"
)

const MaxSplatCount int64 = 2_000_000
const MaxSplatSize int64 = MaxSplatCount * 32

// ValidateSplat accepts only raw splat-v1. It allocates a fixed read buffer and
// never decodes an unbounded header, compressed payload or external reference.
func ValidateSplat(ctx context.Context, r io.Reader, size int64) error {
	invalid := errors.New("invalid splat-v1: expected exact 32-byte records, finite positions, positive linear scales and quantized unit w,x,y,z rotation")
	if size < 32 || size > MaxSplatSize || size%32 != 0 {
		return invalid
	}
	reader := bufio.NewReaderSize(io.LimitReader(r, size+1), 64*1024)
	var record [32]byte
	for n := int64(0); n < size/32; n++ {
		if n%1024 == 0 {
			if err := ctx.Err(); err != nil {
				return errors.New("splat inspection timed out or cancelled")
			}
		}
		if _, err := io.ReadFull(reader, record[:]); err != nil {
			return invalid
		}
		for i := 0; i < 6; i++ {
			v := float64(math.Float32frombits(binary.LittleEndian.Uint32(record[i*4:])))
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return invalid
			}
			if i < 3 {
				if math.Abs(v) > 1e6 {
					return invalid
				}
			} else if v < 1e-6 || v > 1000 {
				return invalid
			}
		}
		norm := 0.0
		for _, b := range record[28:] {
			v := (float64(b) - 128) / 128
			norm += v * v
		}
		if norm < 0.81 || norm > 1.21 {
			return invalid
		}
	}
	if _, err := reader.ReadByte(); err != io.EOF {
		return invalid
	}
	return nil
}

// Splat promotion stages the inspected bytes on bounded local disk and uses a
// conditional PUT, so retries and concurrent completion cannot replace originals.
func (c *Client) confirmSplat(ctx context.Context, key string, size int64) error {
	select {
	case c.splatInspections <- struct{}{}:
		defer func() { <-c.splatInspections }()
	default:
		return errors.New("splat inspection busy; retry completion")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if size < 32 || size > MaxSplatSize || size%32 != 0 {
		return errors.New("invalid splat source size")
	}
	promoted := func() (bool, error) {
		info, err := c.internal.StatObject(ctx, c.bucket, key, minio.StatObjectOptions{})
		if err != nil {
			if minio.ToErrorResponse(err).Code == "NoSuchKey" {
				return false, nil
			}
			return false, errors.New("could not check promoted splat; retry completion")
		}
		if info.Size != size || info.UserMetadata["Splat-Profile"] != "splat-v1" || len(info.UserMetadata["Source-Sha256"]) != 64 {
			return false, errors.New("promoted splat identity does not match; upload a new source")
		}
		return true, nil
	}
	if exists, err := promoted(); exists || err != nil {
		return err
	}
	pending := "pending/" + key
	info, err := c.internal.StatObject(ctx, c.bucket, pending, minio.StatObjectOptions{})
	if err != nil {
		return errors.New("upload not found; upload the file before confirming")
	}
	if info.Size != size {
		return errors.New("uploaded size does not match the declared size")
	}
	options := minio.GetObjectOptions{}
	if err = options.SetMatchETag(info.ETag); err != nil {
		return errors.New("could not bind pending splat identity")
	}
	object, err := c.internal.GetObject(ctx, c.bucket, pending, options)
	if err != nil {
		return errors.New("could not inspect pending splat")
	}
	defer object.Close()
	file, err := os.CreateTemp("", "tour-splat-*")
	if err != nil {
		return errors.New("could not stage splat inspection; retry completion")
	}
	defer os.Remove(file.Name())
	defer file.Close()
	hash := sha256.New()
	if err = ValidateSplat(ctx, io.TeeReader(object, io.MultiWriter(file, hash)), size); err != nil {
		return err
	}
	current, err := c.internal.StatObject(ctx, c.bucket, pending, minio.StatObjectOptions{})
	if err != nil || current.ETag != info.ETag || current.Size != info.Size {
		return errors.New("pending splat changed during inspection; retry completion")
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return errors.New("could not read inspected splat")
	}
	put := minio.PutObjectOptions{ContentType: "application/octet-stream", DisableMultipart: true, UserMetadata: map[string]string{"Splat-Profile": "splat-v1", "Source-Sha256": hex.EncodeToString(hash.Sum(nil))}}
	put.SetMatchETagExcept("*")
	_, err = c.internal.PutObject(ctx, c.bucket, key, file, size, put)
	if err != nil {
		if minio.ToErrorResponse(err).Code == "PreconditionFailed" {
			if exists, recheck := promoted(); exists && recheck == nil {
				return nil
			}
		}
		return errors.New("could not promote inspected splat; retry completion")
	}
	return nil
}
