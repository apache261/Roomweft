package storage

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"testing"
)

func TestValidateGLB(t *testing.T) {
	valid, err := os.ReadFile("../../tests/testdata/house.glb")
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateGLB(bytes.NewReader(valid), int64(len(valid))); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func([]byte){func(b []byte) { b[0] = 0 }, func(b []byte) { b[4] = 1 }, func(b []byte) { b[8] = 0 }, func(b []byte) { binary.LittleEndian.PutUint32(b[12:16], 0xffffffff) }, func(b []byte) { b[20] = '!' }} {
		data := bytes.Clone(valid)
		change(data)
		if ValidateGLB(bytes.NewReader(data), int64(len(data))) == nil {
			t.Fatal("accepted malformed GLB")
		}
	}
	json := []byte(`{"asset":{"version":"2.0"},"buffers":[{"uri":"external.bin"}]}`)
	for len(json)%4 != 0 {
		json = append(json, ' ')
	}
	data := make([]byte, 20)
	copy(data, "glTF")
	binary.LittleEndian.PutUint32(data[4:8], 2)
	binary.LittleEndian.PutUint32(data[8:12], uint32(len(json)+20))
	binary.LittleEndian.PutUint32(data[12:16], uint32(len(json)))
	binary.LittleEndian.PutUint32(data[16:20], 0x4e4f534a)
	data = append(data, json...)
	if ValidateGLB(bytes.NewReader(data), int64(len(data))) == nil {
		t.Fatal("accepted external dependency")
	}
	if ValidateGLB(bytes.NewReader(valid[:25]), int64(len(valid))) == nil {
		t.Fatal("accepted truncated file")
	}
}

// Stream a large BIN chunk without allocating a large fixture or buffer.
type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestLargeGLBValidation(t *testing.T) {
	const binSize int64 = 101 * 1024 * 1024
	json := []byte(fmt.Sprintf(`{"asset":{"version":"2.0"},"buffers":[{"byteLength":%d}]}`, binSize))
	for len(json)%4 != 0 {
		json = append(json, ' ')
	}
	size := int64(28+len(json)) + binSize
	header := make([]byte, 20)
	copy(header, "glTF")
	binary.LittleEndian.PutUint32(header[4:8], 2)
	binary.LittleEndian.PutUint32(header[8:12], uint32(size))
	binary.LittleEndian.PutUint32(header[12:16], uint32(len(json)))
	binary.LittleEndian.PutUint32(header[16:20], 0x4e4f534a)
	bin := make([]byte, 8)
	binary.LittleEndian.PutUint32(bin[:4], uint32(binSize))
	binary.LittleEndian.PutUint32(bin[4:], 0x004e4942)
	reader := io.MultiReader(bytes.NewReader(header), bytes.NewReader(json), bytes.NewReader(bin), io.LimitReader(zeroReader{}, binSize))
	if err := ValidateGLB(reader, size); err != nil {
		t.Fatal(err)
	}
	if err := ValidateGLB(bytes.NewReader(nil), MaxSize+1); err == nil {
		t.Fatal("accepted oversized GLB")
	}
	if err := ValidatePanorama(bytes.NewReader(nil), MaxImageSize+1, ".png"); err == nil {
		t.Fatal("accepted oversized image")
	}
}
