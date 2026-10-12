package storage

import (
	"bytes"
	"context"
	"encoding/binary"
	"math"
	"os"
	"testing"
)

func TestSplatProfile(t *testing.T) {
	data, err := os.ReadFile("../../web/public/splat-fixtures/small.splat")
	if err != nil {
		t.Fatal(err)
	}
	if err = ValidateSplat(context.Background(), bytes.NewReader(data), int64(len(data))); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func([]byte){
		"nan position":    func(b []byte) { binary.LittleEndian.PutUint32(b, math.Float32bits(float32(math.NaN()))) },
		"infinite scale":  func(b []byte) { binary.LittleEndian.PutUint32(b[12:], math.Float32bits(float32(math.Inf(1)))) },
		"negative scale":  func(b []byte) { binary.LittleEndian.PutUint32(b[12:], math.Float32bits(-1)) },
		"zero scale":      func(b []byte) { clear(b[12:16]) },
		"zero quaternion": func(b []byte) { copy(b[28:32], []byte{128, 128, 128, 128}) },
	} {
		t.Run(name, func(t *testing.T) {
			b := bytes.Clone(data)
			change(b)
			if ValidateSplat(context.Background(), bytes.NewReader(b), int64(len(b))) == nil {
				t.Fatal("accepted invalid capture")
			}
		})
	}
	for _, size := range []int64{0, 31, int64(len(data) - 1), MaxSplatSize + 32} {
		if ValidateSplat(context.Background(), bytes.NewReader(data), size) == nil {
			t.Fatal("accepted size", size)
		}
	}
	if ValidateSplat(context.Background(), bytes.NewReader(data[:len(data)-32]), int64(len(data))) == nil {
		t.Fatal("accepted truncation")
	}
	if ValidateSplat(context.Background(), bytes.NewReader(append(data, 0)), int64(len(data))) == nil {
		t.Fatal("accepted trailing data")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if ValidateSplat(ctx, bytes.NewReader(data), int64(len(data))) == nil {
		t.Fatal("ignored cancellation")
	}
	kind, mime, ext := Format("room.SPLAT")
	if kind != "SPLAT" || mime != "application/octet-stream" || ext != ".splat" || UploadSizeLimit(kind) != MaxSplatSize {
		t.Fatal("format contract")
	}
	for _, name := range []string{"room.ply", "room.spz", "room.ksplat", "room.splat.exe"} {
		if k, _, _ := Format(name); k != "" {
			t.Fatal("admitted unsupported format")
		}
	}
}
