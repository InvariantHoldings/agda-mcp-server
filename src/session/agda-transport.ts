import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import type { AgdaResponse } from "../agda/types.js";
import { normalizeAgdaResponse } from "../agda/normalize-response.js";
import { logger } from "../agda/logger.js";
import { terminateAgdaProcess } from "../agda/agda-process-spawn.js";
import {
  type CommandCompletionOrigin,
  configuredCommandTimeoutMs,
  configuredWaitingSentryMs,
  idleCompletionDelay,
  shouldResolveOnIdle,
  summarizeResponseKinds,
  tailResponsePreview,
  trailingResponseDelay,
} from "./command-completion.js";
import { parseAgdaStdoutLine } from "./stdout-line.js";

export class AgdaTransport {
  buffer = "";
  responseQueue: AgdaResponse[] = [];
  emitter = new EventEmitter();
  collecting = false;
  private sawStatusDone = false;
  private idleDoneTimer: NodeJS.Timeout | null = null;
  private lastResponseAt: number | null = null;
  private lastResponseKind: string | null = null;

  handleStdout(chunk: Buffer): void {
    this.buffer += chunk.toString();
    this.drainBuffer();
  }

  handleStderr(chunk: Buffer): void {
    if (!this.collecting) {
      return;
    }

    this.recordCollectedResponse({
      kind: "StderrOutput",
      text: chunk.toString(),
    });
  }

  handleProcessClose(): void {
    this.collecting = false;
    this.clearIdleCompletionTimer();
    this.emitter.emit("done", "process-close");
  }

  handleProcessError(error: Error): void {
    this.emitter.emit("error", error);
  }

  /**
   * Reset transport state and unblock any in-flight `sendCommand`.
   *
   * Emitting `"error"` on the shared emitter is critical: when
   * `AgdaSession.destroy()` is called while a command is in flight,
   * the proc listeners are detached *before* termination, so the
   * subprocess's eventual `close` event never reaches the emitter
   * and the command's `done` listener never fires. Without this
   * emission the caller would wait for the original per-command
   * timeout (default 120s) before observing the shutdown. We guard
   * with `listenerCount` because EventEmitter throws on an
   * unhandled `"error"` emission when no listener is registered.
   */
  destroy(): void {
    this.clearIdleCompletionTimer();
    this.buffer = "";
    this.responseQueue = [];
    this.collecting = false;
    this.sawStatusDone = false;
    this.lastResponseAt = null;
    this.lastResponseKind = null;
    if (this.emitter.listenerCount("error") > 0) {
      this.emitter.emit(
        "error",
        new Error("AgdaTransport destroyed while command was in flight"),
      );
    }
  }

  sendCommand(
    proc: ChildProcess,
    command: string,
    timeoutMs = configuredCommandTimeoutMs(),
  ): Promise<AgdaResponse[]> {
    logger.trace("sendCommand", { command: command.slice(0, 200), timeoutMs });
    const startTime = Date.now();

    this.responseQueue = [];
    this.collecting = true;
    this.sawStatusDone = false;
    this.lastResponseAt = null;
    this.lastResponseKind = null;

    return new Promise<AgdaResponse[]>((resolveCmd, rejectCmd) => {
      const sentryIntervalMs = configuredWaitingSentryMs();
      const waitingSentry = sentryIntervalMs > 0
        ? setInterval(() => {
            logger.warn("sendCommand still waiting", {
              command: command.slice(0, 100),
              elapsedMs: Date.now() - startTime,
              responseCount: this.responseQueue.length,
              sawStatusDone: this.sawStatusDone,
              msSinceLastResponse: this.lastResponseAt === null
                ? null
                : Date.now() - this.lastResponseAt,
              lastResponseKind: this.lastResponseKind,
              responseKinds: summarizeResponseKinds(this.responseQueue),
              responseTail: tailResponsePreview(this.responseQueue),
            });
          }, sentryIntervalMs)
        : null;

      const finish = (handler: () => void) => {
        this.collecting = false;
        this.clearIdleCompletionTimer();
        if (waitingSentry) {
          clearInterval(waitingSentry);
        }
        this.emitter.removeListener("done", onDone);
        this.emitter.removeListener("error", onError);
        handler();
      };

      const timeout = setTimeout(() => {
        logger.warn("sendCommand timed out", {
          command: command.slice(0, 100),
          timeoutMs,
          responseCount: this.responseQueue.length,
          sawStatusDone: this.sawStatusDone,
          elapsedMs: Date.now() - startTime,
          msSinceLastResponse: this.lastResponseAt === null
            ? null
            : Date.now() - this.lastResponseAt,
          lastResponseKind: this.lastResponseKind,
          responseKinds: summarizeResponseKinds(this.responseQueue),
          responseTail: tailResponsePreview(this.responseQueue),
        });
        // Resource leak fix (0.6.7): ensure the subprocess is killed
        // when a command times out, so we don't leave a zombie burning
        // CPU and memory until the session is explicitly destroyed.
        terminateAgdaProcess(proc);
        finish(() => {
          resolveCmd([...this.responseQueue]);
        });
      }, timeoutMs);

      const onDone = (origin: CommandCompletionOrigin = "signal") => {
        const trailingDelay = trailingResponseDelay({
          sawStatusDone: this.sawStatusDone,
          responseCount: this.responseQueue.length,
          lastResponseKind: this.lastResponseKind,
        }, origin);

        setTimeout(() => {
          clearTimeout(timeout);
          finish(() => {
            const responses = [...this.responseQueue];
            logger.trace("sendCommand done", {
              responses: responses.length,
              durationMs: Date.now() - startTime,
            });
            resolveCmd(responses);
          });
        }, trailingDelay);
      };

      const onError = (err: Error) => {
        clearTimeout(timeout);
        finish(() => {
          rejectCmd(err);
        });
      };

      this.emitter.on("done", onDone);
      this.emitter.on("error", onError);

      proc.stdin?.write(`${command}\n`);
    });
  }

  private drainBuffer(): void {
    let start = 0;
    let newlineIdx: number;

    while ((newlineIdx = this.buffer.indexOf("\n", start)) !== -1) {
      const line = this.buffer.slice(start, newlineIdx);
      start = newlineIdx + 1;

      const parsedLine = parseAgdaStdoutLine(line);
      if (parsedLine.noticeText) {
        this.recordCollectedResponse({
          kind: "StderrOutput",
          text: parsedLine.noticeText,
        });
      }

      if (!parsedLine.jsonText) {
        continue;
      }

      try {
        const response = normalizeAgdaResponse(JSON.parse(parsedLine.jsonText));
        this.recordCollectedResponse(response);
      } catch {
        logger.trace("Skipped unparseable line", { line: line.slice(0, 120) });
      }
    }

    if (start > 0) {
      this.buffer = this.buffer.slice(start);
    }
  }

  private recordCollectedResponse(response: AgdaResponse): void {
    if (!this.collecting) {
      return;
    }

    this.responseQueue.push(response);
    this.lastResponseAt = Date.now();
    this.lastResponseKind = response.kind;

    if (response.kind === "Status") {
      this.sawStatusDone = true;
    }

    this.bumpIdleCompletionTimer();
  }

  private clearIdleCompletionTimer(): void {
    if (this.idleDoneTimer) {
      clearTimeout(this.idleDoneTimer);
      this.idleDoneTimer = null;
    }
  }

  private bumpIdleCompletionTimer(): void {
    this.clearIdleCompletionTimer();

    if (!this.collecting) {
      return;
    }

    if (!shouldResolveOnIdle({
      sawStatusDone: this.sawStatusDone,
      responseCount: this.responseQueue.length,
      lastResponseKind: this.lastResponseKind,
    })) {
      return;
    }

    this.idleDoneTimer = setTimeout(() => {
      if (!this.collecting) {
        return;
      }

      logger.trace("sendCommand idle-complete", {
        responses: this.responseQueue.length,
        sawStatusDone: this.sawStatusDone,
        lastResponseKind: this.lastResponseKind,
      });
      this.emitter.emit("done", "idle");
    }, idleCompletionDelay({
      sawStatusDone: this.sawStatusDone,
      responseCount: this.responseQueue.length,
      lastResponseKind: this.lastResponseKind,
    }));
  }
}
