// Fiber 9 exposes Clock's interface to its frame loop and Drei. Keep that
// interface while using the supported Three Timer instead of constructing Clock.
export function createTimerClock(Timer, autoStart = true) {
  const timer = new Timer();
  return {
    autoStart,
    startTime: 0,
    oldTime: 0,
    elapsedTime: 0,
    running: false,
    start() {
      this.startTime = this.oldTime = performance.now();
      this.elapsedTime = 0;
      this.running = true;
      timer.reset();
    },
    stop() {
      this.getElapsedTime();
      this.running = false;
      this.autoStart = false;
    },
    getElapsedTime() {
      this.getDelta();
      return this.elapsedTime;
    },
    getDelta() {
      if (this.autoStart && !this.running) {
        this.start();
        return 0;
      }
      if (!this.running) return 0;
      timer.update();
      const delta = timer.getDelta();
      this.oldTime = performance.now();
      this.elapsedTime += delta;
      return delta;
    },
  };
}
