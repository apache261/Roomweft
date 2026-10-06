package derivatives

import "context"

type retirementStore interface {
	QueueStorageRetirement(context.Context, string) error
	ClaimStorageRetirement(context.Context) (string, error)
	FinishStorageRetirement(context.Context, string, string) error
}

// Failed attempt cleanup also gets a durable retry when object storage is down.
func retireFailedObject(ctx context.Context, store Store, objects Objects, key string) {
	if err := objects.Delete(ctx, key); err != nil {
		if r, ok := store.(retirementStore); ok {
			_ = r.QueueStorageRetirement(ctx, key)
		}
	}
}
func cleanRetiredObjects(ctx context.Context, store Store, objects Objects) {
	r, ok := store.(retirementStore)
	if !ok {
		return
	}
	for i := 0; i < 16; i++ {
		key, err := r.ClaimStorageRetirement(ctx)
		if err != nil {
			return
		}
		message := ""
		if err = objects.Delete(ctx, key); err != nil {
			message = err.Error()
		}
		if r.FinishStorageRetirement(ctx, key, message) != nil {
			return
		}
	}
}
