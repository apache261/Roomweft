package httpapi

import (
	"fmt"
	"net/http"
)

type SplatRollout string

const (
	SplatOff    SplatRollout = "off"
	SplatViewer SplatRollout = "viewer"
	SplatOn     SplatRollout = "on"
)

func ParseSplatRollout(value string) (SplatRollout, error) {
	if value == "" {
		return SplatOff, nil
	}
	mode := SplatRollout(value)
	if mode != SplatOff && mode != SplatViewer && mode != SplatOn {
		return "", fmt.Errorf("ASSET_SPLAT_SUPPORT must be off, viewer or on")
	}
	return mode, nil
}
func (a *API) splatCapabilities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	respond(w, 200, map[string]bool{"splat_viewer": a.splatSupport == SplatOn || a.splatSupport == SplatViewer, "splat_walking": a.splatWalking && (a.splatSupport == SplatOn || a.splatSupport == SplatViewer), "splat_streaming": a.splatStreaming && (a.splatSupport == SplatOn || a.splatSupport == SplatViewer), "splat_authoring": a.splatSupport == SplatOn})
}
func (a *API) allowSplat(w http.ResponseWriter, kind string, authoring bool) bool {
	if kind != "SPLAT" {
		return true
	}
	if a.splatSupport == SplatOn || !authoring && a.splatSupport == SplatViewer {
		return true
	}
	fail(w, http.StatusServiceUnavailable, "Gaussian splat support is unavailable. Choose another scene or retry later.")
	return false
}

func ParseSplatFeature(name, value string) (bool, error) {
	if value == "" || value == "off" {
		return false, nil
	}
	if value == "on" {
		return true, nil
	}
	return false, fmt.Errorf("%s must be off or on", name)
}
