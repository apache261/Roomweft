package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"virtual-tour/db"
	"virtual-tour/internal/database"
	"virtual-tour/internal/derivatives"
	"virtual-tour/internal/httpapi"
	"virtual-tour/internal/storage"
)

func main() {
	if err := run(); err != nil {
		slog.Error("API stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer pool.Close()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := pool.Ping(startup); err != nil {
		return err
	}
	if err := db.Migrate(startup, pool); err != nil {
		return err
	}
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	objects, err := storage.FromEnv()
	if err != nil {
		return err
	}
	queries := database.New(pool)
	if script := os.Getenv("ASSET_PROCESSOR_SCRIPT"); script != "" {
		workerDone := make(chan struct{})
		go func() { defer close(workerDone); derivatives.Run(ctx, queries, objects, script) }()
		defer func() { stop(); <-workerDone }()
	}
	server := &http.Server{Addr: addr, Handler: httpapi.New(queries, pool.Ping, objects), ReadHeaderTimeout: 5 * time.Second}
	result := make(chan error, 1)
	go func() { slog.Info("API listening", "address", addr); result <- server.ListenAndServe() }()
	select {
	case err := <-result:
		if err == http.ErrServerClosed {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
