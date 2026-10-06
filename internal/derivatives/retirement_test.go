package derivatives

import (
	"context"
	"errors"
	"testing"
)

type retirementFake struct {
	fakeStore
	queued   []string
	claims   []string
	finished map[string]string
}

func (r *retirementFake) QueueStorageRetirement(_ context.Context, key string) error {
	r.queued = append(r.queued, key)
	return nil
}
func (r *retirementFake) ClaimStorageRetirement(context.Context) (string, error) {
	if len(r.claims) == 0 {
		return "", errors.New("empty")
	}
	key := r.claims[0]
	r.claims = r.claims[1:]
	return key, nil
}
func (r *retirementFake) FinishStorageRetirement(_ context.Context, key, message string) error {
	if r.finished == nil {
		r.finished = map[string]string{}
	}
	r.finished[key] = message
	return nil
}

type retirementObjects struct {
	fakeObjects
	fail bool
}

func (o *retirementObjects) Delete(context.Context, string) error {
	o.deletes++
	if o.fail {
		return errors.New("storage offline")
	}
	return nil
}
func TestRetirementRetryLifecycle(t *testing.T) {
	ctx := context.Background()
	store := &retirementFake{}
	objects := &retirementObjects{fail: true}
	retireFailedObject(ctx, store, objects, "failed-attempt")
	if len(store.queued) != 1 || store.queued[0] != "failed-attempt" {
		t.Fatal("failed cleanup was not durable")
	}
	store.claims = []string{"old-partition"}
	cleanRetiredObjects(ctx, store, objects)
	if store.finished["old-partition"] == "" {
		t.Fatal("failure was not recorded for retry")
	}
	objects.fail = false
	store.claims = []string{"old-partition"}
	cleanRetiredObjects(ctx, store, objects)
	if store.finished["old-partition"] != "" {
		t.Fatal("successful retry was not acknowledged")
	}
}
