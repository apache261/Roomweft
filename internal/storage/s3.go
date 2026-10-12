package storage

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	_ "golang.org/x/image/webp"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

const MaxSize int64 = 1000 * 1024 * 1024
const MaxImageSize int64 = 100 * 1024 * 1024

// UploadSizeLimit keeps GLB and image limits consistent across admission and completion.
func UploadSizeLimit(kind string) int64 {
	if kind == "SPLAT" {
		return MaxSplatSize
	}
	if kind == "GLB" {
		return MaxSize
	}
	return MaxImageSize
}

const ContentType = "model/gltf-binary"

type Upload struct {
	URL       string            `json:"url"`
	Fields    map[string]string `json:"fields"`
	ExpiresAt time.Time         `json:"expires_at"`
}
type Client struct {
	internal, public *minio.Client
	bucket           string
	splatInspections chan struct{}
}

func FromEnv() (*Client, error) {
	bucket := os.Getenv("S3_BUCKET")
	if bucket == "" {
		bucket = "virtual-tours"
	}
	creds := credentials.NewChainCredentials([]credentials.Provider{&credentials.EnvAWS{}, &credentials.IAM{}})
	if key := os.Getenv("S3_ACCESS_KEY"); key != "" {
		creds = credentials.NewStaticV4(key, os.Getenv("S3_SECRET_KEY"), os.Getenv("S3_SESSION_TOKEN"))
	}
	region := os.Getenv("S3_REGION")
	if region == "" {
		region = "us-east-1"
	}
	endpoint := os.Getenv("S3_ENDPOINT")
	if endpoint == "" {
		endpoint = "https://s3." + region + ".amazonaws.com"
	}
	public := os.Getenv("S3_PUBLIC_ENDPOINT")
	if public == "" {
		public = endpoint
	}
	makeClient := func(endpoint string) (*minio.Client, error) {
		u, err := url.Parse(endpoint)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || (u.Path != "" && u.Path != "/") {
			return nil, fmt.Errorf("invalid S3 endpoint")
		}
		return minio.New(u.Host, &minio.Options{Creds: creds, Secure: u.Scheme == "https", Region: region, BucketLookup: minio.BucketLookupPath})
	}
	internal, err := makeClient(endpoint)
	if err != nil {
		return nil, err
	}
	browser, err := makeClient(public)
	if err != nil {
		return nil, err
	}
	return &Client{internal: internal, public: browser, bucket: bucket, splatInspections: make(chan struct{}, 2)}, nil
}
func (c *Client) PresignUpload(ctx context.Context, key string, size int64) (Upload, error) {
	kind, _, _ := Format(key)
	if size < 20 || size > UploadSizeLimit(kind) || (kind == "SPLAT" && (size < 32 || size%32 != 0)) {
		return Upload{}, fmt.Errorf("file size must be between 20 bytes and %d MiB", UploadSizeLimit(kind)/(1024*1024))
	}
	policy := minio.NewPostPolicy()
	expires := time.Now().Add(15 * time.Minute)
	for _, err := range []error{policy.SetBucket(c.bucket), policy.SetKey("pending/" + key), policy.SetExpires(expires), policy.SetContentType(contentType(key)), policy.SetContentLengthRange(size, size)} {
		if err != nil {
			return Upload{}, err
		}
	}
	u, fields, err := c.public.PresignedPostPolicy(ctx, policy)
	if err != nil {
		return Upload{}, err
	}
	return Upload{u.String(), fields, expires}, nil
}
func (c *Client) ReadURL(ctx context.Context, key string) (string, error) {
	u, err := c.public.PresignedGetObject(ctx, c.bucket, key, 15*time.Minute, nil)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}
func (c *Client) Confirm(ctx context.Context, key string, size int64) error {
	if kind, _, _ := Format(key); kind == "SPLAT" {
		return c.confirmSplat(ctx, key, size)
	}
	object, err := c.internal.GetObject(ctx, c.bucket, "pending/"+key, minio.GetObjectOptions{})
	if err != nil {
		return err
	}
	defer object.Close()
	info, err := object.Stat()
	if err != nil {
		return fmt.Errorf("upload not found; upload the file before confirming: %w", err)
	}
	kind, _, _ := Format(key)
	if info.Size != size || size < 20 || size > UploadSizeLimit(kind) {
		return errors.New("uploaded size does not match the declared size")
	}
	// Bind the GET to the exact identity inspected below as well as the copy.
	object.Close()
	options := minio.GetObjectOptions{}
	if err := options.SetMatchETag(info.ETag); err != nil {
		return errors.New("could not bind upload identity")
	}
	object, err = c.internal.GetObject(ctx, c.bucket, "pending/"+key, options)
	if err != nil {
		return errors.New("could not inspect pending upload")
	}
	defer object.Close()
	if strings.EqualFold(filepath.Ext(key), ".glb") {
		if err := ValidateGLB(object, size); err != nil {
			return err
		}
	} else {
		if err := validateImage(object, size, filepath.Ext(key), !strings.HasPrefix(key, "images/") && !strings.HasPrefix(key, "textures/")); err != nil {
			return err
		}
	}
	_, err = c.internal.CopyObject(ctx, minio.CopyDestOptions{Bucket: c.bucket, Object: key}, minio.CopySrcOptions{Bucket: c.bucket, Object: "pending/" + key, MatchETag: info.ETag})
	return err
}
func (c *Client) Delete(ctx context.Context, key string) error {
	if err := c.internal.RemoveObject(ctx, c.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return err
	}
	return c.internal.RemoveObject(ctx, c.bucket, "pending/"+key, minio.RemoveObjectOptions{})
}

// ValidateGLB checks the v2 container and embedded resources without rewriting it.
func ValidateGLB(r io.Reader, size int64) error {
	if size < 20 || size > MaxSize {
		return errors.New("GLB size must be between 20 bytes and 1000 MiB")
	}
	invalid := errors.New("invalid GLB: use a self-contained glTF 2.0 binary model")
	var header [12]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return invalid
	}
	if string(header[:4]) != "glTF" || binary.LittleEndian.Uint32(header[4:8]) != 2 || int64(binary.LittleEndian.Uint32(header[8:])) != size {
		return invalid
	}
	remaining := size - 12
	index := 0
	for remaining > 0 {
		var chunk [8]byte
		if remaining < 8 {
			return invalid
		}
		if _, err := io.ReadFull(r, chunk[:]); err != nil {
			return invalid
		}
		n := int64(binary.LittleEndian.Uint32(chunk[:4]))
		kind := binary.LittleEndian.Uint32(chunk[4:])
		remaining -= 8
		if n <= 0 || n%4 != 0 || n > remaining {
			return invalid
		}
		if index == 0 {
			if kind != 0x4e4f534a || n > 8*1024*1024 {
				return invalid
			}
			data := make([]byte, n)
			if _, err := io.ReadFull(r, data); err != nil {
				return invalid
			}
			var model struct {
				Asset struct {
					Version string `json:"version"`
				} `json:"asset"`
				Buffers []struct {
					URI string `json:"uri"`
				} `json:"buffers"`
				Images []struct {
					URI string `json:"uri"`
				} `json:"images"`
			}
			if json.Unmarshal(data, &model) != nil || model.Asset.Version != "2.0" {
				return invalid
			}
			for _, b := range model.Buffers {
				if b.URI != "" && !strings.HasPrefix(b.URI, "data:") {
					return invalid
				}
			}
			for _, im := range model.Images {
				if im.URI != "" && !strings.HasPrefix(im.URI, "data:") {
					return invalid
				}
			}
		} else {
			if index != 1 || kind != 0x004e4942 {
				return invalid
			}
			if _, err := io.CopyN(io.Discard, r, n); err != nil {
				return invalid
			}
		}
		remaining -= n
		index++
	}
	if index == 0 {
		return invalid
	}
	return nil
}

// Format infers the supported upload category and canonical storage extension.
func Format(name string) (kind, mime, extension string) {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".splat":
		return "SPLAT", "application/octet-stream", ".splat"
	case ".glb":
		return "GLB", ContentType, ".glb"
	case ".jpg", ".jpeg":
		return "PANORAMA", "image/jpeg", ".jpg"
	case ".png":
		return "PANORAMA", "image/png", ".png"
	case ".webp":
		return "PANORAMA", "image/webp", ".webp"
	}
	return "", "", ""
}
func contentType(key string) string { _, mime, _ := Format(key); return mime }

// Check dimensions before decoding pixels to bound image memory use.
func ValidatePanorama(r io.Reader, size int64, extension string) error {
	return validateImage(r, size, extension, true)
}
func validateImage(r io.Reader, size int64, extension string, panorama bool) error {
	if size < 20 || size > MaxImageSize {
		return errors.New("panorama size must be between 20 bytes and 100 MiB")
	}
	data, err := io.ReadAll(io.LimitReader(r, size+1))
	if err != nil || int64(len(data)) != size {
		return errors.New("panorama is truncated or has an incorrect size")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	_, expected, _ := Format("panorama" + extension)
	if err != nil || expected != "image/"+format || expected == "" {
		return errors.New("panorama must be a valid JPG, PNG or WebP matching its file extension")
	}
	if config.Width < 1 || config.Height < 1 || config.Width > 8192 || config.Height > 4096 || (panorama && config.Width != 2*config.Height) {
		return errors.New("image must be at most 8192 × 4096 pixels; panoramas require 2:1 dimensions")
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return errors.New("panorama pixels could not be decoded; the image may be truncated")
	}
	return nil
}

// Download reads only completed private objects and enforces the declared size.
func (c *Client) Download(ctx context.Context, key, target string, size int64) error {
	object, err := c.internal.GetObject(ctx, c.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return err
	}
	defer object.Close()
	info, err := object.Stat()
	if err != nil {
		return err
	}
	if info.Size != size {
		return errors.New("source size changed")
	}
	file, err := os.Create(target)
	if err != nil {
		return err
	}
	defer file.Close()
	n, err := io.Copy(file, io.LimitReader(object, size+1))
	if err != nil {
		return err
	}
	if n != size {
		return errors.New("source was truncated")
	}
	return file.Close()
}
func (c *Client) PutFile(ctx context.Context, key, source, contentType string) error {
	_, err := c.internal.FPutObject(ctx, c.bucket, key, source, minio.PutObjectOptions{ContentType: contentType})
	return err
}
