//go:build ignore

// Export the strict structural schema from the Go contracts. Semantic validation
// (coverage, references, ownership and readiness) remains in Go and TypeScript.
package main

import (
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"strings"
	"virtual-tour/internal/chunking"
)

var definitions = map[string]any{}

func properties(t reflect.Type) map[string]reflect.StructField {
	result := map[string]reflect.StructField{}
	for j := 0; j < t.NumField(); j++ {
		f := t.Field(j)
		if f.Anonymous {
			for k, v := range properties(f.Type) {
				result[k] = v
			}
		}
	}
	for j := 0; j < t.NumField(); j++ {
		f := t.Field(j)
		tag := strings.Split(f.Tag.Get("json"), ",")
		if tag[0] != "" && tag[0] != "-" {
			result[tag[0]] = f
		}
	}
	return result
}
func schema(t reflect.Type) any {
	if t.Kind() == reflect.Pointer {
		value := schema(t.Elem())
		if t.Elem().Kind() == reflect.Struct || t.Elem().Kind() == reflect.String {
			return map[string]any{"anyOf": []any{value, map[string]any{"type": "null"}}}
		}
		return value
	}
	if t.Name() != "" && (t.Kind() == reflect.Struct || t.Kind() == reflect.Array) {
		name := t.Name()
		if _, ok := definitions[name]; !ok {
			definitions[name] = nil
			definitions[name] = shape(t)
		}
		return map[string]any{"$ref": "#/$defs/" + name}
	}
	return shape(t)
}
func shape(t reflect.Type) map[string]any {
	switch t.Kind() {
	case reflect.Struct:
		fields := map[string]any{}
		required := []string{}
		for name, f := range properties(t) {
			value := schema(f.Type)
			tag := strings.Split(f.Tag.Get("json"), ",")
			if len(tag) == 1 || tag[1] != "omitempty" {
				required = append(required, name)
			}
			field := map[string]any{"allOf": []any{value}}
			switch name {
			case "schema":
				if t.Name() == "Manifest" || t.Name() == "DeliveredManifest" {
					field["const"] = chunking.ManifestSchema
				} else if t.Name() == "Inventory" {
					field["const"] = chunking.InventorySchema
				} else if t.Name() == "Partition" {
					field["const"] = chunking.PartitionSchema
				}
			case "processor_version":
				field["const"] = chunking.ProcessorVersion
			case "coordinates":
				field["const"] = "source-space"
			case "source_sha256", "sha256":
				field["pattern"] = "^[a-f0-9]{64}$"
			case "parent_asset_id":
				field["pattern"] = "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$"
			case "policy":
				field["enum"] = []string{"complete", "reviewed-rooms"}
			case "visibility":
				field["enum"] = []string{"conservative", "reviewed-openings"}
			case "fallback":
				field["const"] = "complete-original"
			case "kind":
				switch t.Name() {
				case "Opening":
					field["enum"] = []string{"doorway", "window"}
				case "Dependency":
					field["const"] = "authored-hierarchy"
				default:
					field["enum"] = []string{"texture", "animation", "shared-contributor"}
				}
			case "id", "dependency_group":
				field["pattern"] = "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$"
			case "path", "source_path", "chunk_path", "parent":
				field["pattern"] = "^0(/(0|[1-9][0-9]*))*$"
			case "node_paths", "source_node_paths", "global_node_paths", "floor_source_paths":
				field["items"] = map[string]any{"type": "string", "pattern": "^0(/(0|[1-9][0-9]*))*$"}
				field["uniqueItems"] = true
			case "bytes", "source_bytes":
				field["minimum"] = 20
			case "partition_revision":
				field["minimum"] = 1
			case "triangle_count", "primitive_count":
				field["minimum"] = 1
			case "url":
				field["format"] = "uri"
				field["pattern"] = "^https?://"
				field["maxLength"] = 16384
			case "key":
				field["minLength"] = 1
				field["maxLength"] = 1024
				field["pattern"] = `^(?!/)(?!.*\.\.)(?!.*[\\?:#]).+$`
			case "reviewed":
				field["const"] = true
			case "rooms", "regions":
				field["maxItems"] = 512
			case "openings":
				field["maxItems"] = 2048
			case "variants":
				field = map[string]any{"type": "object", "required": []string{"low", "balanced", "hq"}, "additionalProperties": false, "properties": map[string]any{"low": schema(f.Type.Elem()), "balanced": schema(f.Type.Elem()), "hq": schema(f.Type.Elem())}}
			case "navigation", "occlusion":
				strategy, semantics := "verified-exact-geometry", "authored-only-floors"
				if name == "occlusion" {
					strategy, semantics = "verified-authored-occluders", "authored-material-visibility-sidedness"
				}
				field["properties"] = map[string]any{"strategy": map[string]any{"const": strategy}, "authored_semantics": map[string]any{"const": semantics}}
			}
			fields[name] = field
		}
		sort.Strings(required)
		return map[string]any{"type": "object", "additionalProperties": false, "properties": fields, "required": required}
	case reflect.Array:
		return map[string]any{"type": "array", "items": schema(t.Elem()), "minItems": t.Len(), "maxItems": t.Len()}
	case reflect.Slice:
		return map[string]any{"type": "array", "items": schema(t.Elem()), "maxItems": chunking.MaxRecords}
	case reflect.Map:
		return map[string]any{"type": "object", "additionalProperties": schema(t.Elem())}
	case reflect.String:
		return map[string]any{"type": "string"}
	case reflect.Bool:
		return map[string]any{"type": "boolean"}
	case reflect.Int, reflect.Int64:
		return map[string]any{"type": "integer", "minimum": 0, "maximum": 9007199254740991}
	case reflect.Float64:
		return map[string]any{"type": "number"}
	}
	panic("unsupported contract type: " + t.String())
}
func main() {
	refs := []any{schema(reflect.TypeOf(chunking.Manifest{})), schema(reflect.TypeOf(chunking.DeliveredManifest{})), schema(reflect.TypeOf(chunking.Inventory{})), schema(reflect.TypeOf(chunking.Partition{}))}
	result := map[string]any{"$schema": "https://json-schema.org/draft/2020-12/schema", "title": "Source inventory, reviewed partition and streaming-v1 contracts", "oneOf": refs, "$defs": definitions}
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		panic(err)
	}
	data = append(data, '\n')
	if err = os.WriteFile("docs/chunking.schema.json", data, 0644); err != nil {
		panic(err)
	}
}
