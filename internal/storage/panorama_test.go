package storage

import (
	"bytes"
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"testing"
)

func TestPanoramaValidation(t *testing.T) {
	for _, name := range []string{"panorama-a.png", "panorama-b.jpg", "panorama.webp"} {
		data, err := os.ReadFile("../../tests/testdata/" + name)
		if err != nil {
			t.Fatal(err)
		}
		_, _, ext := Format(name)
		if err := ValidatePanorama(bytes.NewReader(data), int64(len(data)), ext); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if err := ValidatePanorama(bytes.NewReader(data[:len(data)/2]), int64(len(data)/2), ext); err == nil {
			t.Fatalf("accepted truncated %s", name)
		}
		other := ".png"
		if ext == other {
			other = ".jpg"
		}
		if err := ValidatePanorama(bytes.NewReader(data), int64(len(data)), other); err == nil {
			t.Fatalf("accepted mismatched extension for %s", name)
		}
	}
	for _, size := range [][2]int{{128, 128}, {8194, 4097}} {
		var encoded bytes.Buffer
		png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, size[0], size[1])))
		if err := ValidatePanorama(bytes.NewReader(encoded.Bytes()), int64(encoded.Len()), ".png"); err == nil {
			t.Fatalf("accepted dimensions %v", size)
		}
	}
	// A valid header with missing pixel data must fail even if the declared size matches.
	var encoded bytes.Buffer
	jpeg.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 256, 128)), nil)
	data := encoded.Bytes()[:encoded.Len()-20]
	if err := ValidatePanorama(bytes.NewReader(data), int64(len(data)), ".jpg"); err == nil {
		t.Fatal("accepted incomplete JPEG pixels")
	}
}

func TestInformationImageValidation(t *testing.T) {
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 48, 64))); err != nil {
		t.Fatal(err)
	}
	content := data.Bytes()
	if err := validateImage(bytes.NewReader(content), int64(len(content)), ".png", false); err != nil {
		t.Fatal(err)
	}
	if err := ValidatePanorama(bytes.NewReader(content), int64(len(content)), ".png"); err == nil {
		t.Fatal("portrait accepted as panorama")
	}
	if err := validateImage(bytes.NewReader(content), int64(len(content)), ".jpg", false); err == nil {
		t.Fatal("extension mismatch accepted")
	}
	if err := validateImage(bytes.NewReader(content[:len(content)/2]), int64(len(content)/2), ".png", false); err == nil {
		t.Fatal("truncated image accepted")
	}
}
