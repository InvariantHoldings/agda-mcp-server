import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import type { AgdaResponse } from "../agda/types.js";
import { logger } from "../agda/logger.js";
import { terminateAgdaProcess } from "../agda/agda-process-spawn.js";
import {
  configuredCommandTimeoutMs,
  configuredWaitingSentryMs,
  summarizeResponseKinds,
  tailResponsePreview,
} from "./command-completion.js";
import {
  AgdaStdoutFramer,
  type StdoutFrameEvent,
} from "./stdout-framer.js";
import { decodeResponse } from "./response-frame-decoder.js";
import { startupFailure } from "./transport-startup.js";
import {
  rejectReadyWaiters,
  removeReadyWaiter,
  waitUntilReady,
  type ReadyWaiter,
} from "./transport-readiness.js";
/** Distinguishes control-command interruption from protocol failure. */
export class ControlCommandInterruption extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ControlCommandInterruption";
  }
}
const CONTROL_RESPONSE_KINDS: ReadonlySet<string> = new Set([
  "DoneAborting",
  "DoneExiting",
]);
const DEFAULT_CONTROL_ESCALATION_MS = 5_000;
type TransportPhase = "starting" | "ready" | "running" | "dead";
/** Agda stdout transport: prompt-framed, startup-aware, generation-safe. */
export class AgdaTransport {
  /** Compatibility surface; framing owns the bytes. */
  buffer = "";
  responseQueue: AgdaResponse[] = [];
  emitter = new EventEmitter();
  collecting = false;
  private readonly framer = new AgdaStdoutFramer();
  private activeProcess: ChildProcess | null = null;
  private generation = 0;
  private phase: TransportPhase = "ready";
  private readonly readyWaiters: ReadyWaiter[] = [];
  private currentCommandKind: "regular" | "control" | null = null;
  private outstandingRequest = false;
  /** A control flush without a prompt leaves the stream uncertain. */
  private uncertainControl = false;
  private controlEscalationTimer: NodeJS.Timeout | null = null;
  private lastResponseAt: number | null = null;
  private lastResponseKind: string | null = null;
  private startupResponses: AgdaResponse[] = [];
  private startupFault: Error | null = null;
  get processGeneration(): number {
    return this.generation;
  }
  /** Attach a process and require its startup prompt. */
  attachProcess(proc: ChildProcess): number {
    if (this.activeProcess !== null && this.activeProcess !== proc) {
      const oldGeneration = this.generation;
      rejectReadyWaiters(
        this.readyWaiters,
        new Error("Agda process was replaced while waiting for startup"),
        oldGeneration,
      );
      if (this.collecting) {
        this.rejectInFlightCommand("Agda process was replaced while a command was in flight");
      }
    }
    this.activeProcess = proc;
    this.generation += 1;
    this.phase = "starting";
    this.collecting = false;
    this.currentCommandKind = null;
    this.outstandingRequest = false;
    this.uncertainControl = false;
    this.responseQueue = [];
    this.lastResponseAt = null;
    this.lastResponseKind = null;
    this.startupResponses = [];
    this.startupFault = null;
    this.framer.reset();
    this.buffer = "";
    return this.generation;
  }
  handleStdout(chunk: Buffer, generation = this.generation): void {
    if (generation !== this.generation) return;
    if (this.phase === "dead") return;
    const events = this.framer.push(chunk);
    this.buffer = "";
    for (const event of events) this.handleFrameEvent(event, generation);
  }
  handleStderr(chunk: Buffer, generation = this.generation): void {
    if (generation !== this.generation || this.phase === "dead") return;
    if (!this.collecting) {
      if (this.phase === "starting" && chunk.toString().trim()) {
        this.startupFault = new Error(chunk.toString().trim());
      }
      return;
    }
    this.recordResponse({ kind: "StderrOutput", text: chunk.toString() });
  }
  handleProcessClose(proc?: ChildProcess, generation = this.generation): void {
    if (generation !== this.generation) return;
    if (proc && this.activeProcess && proc !== this.activeProcess) return;
    const wasRunning = this.phase === "running";
    this.phase = "dead";
    this.collecting = false;
    this.outstandingRequest = false;
    this.uncertainControl = false;
    this.clearControlEscalationTimer();
    this.framer.reset();
    this.buffer = "";
    const error = new Error(
      wasRunning
        ? "Agda process closed before command prompt"
        : "Agda process closed before startup prompt",
    );
    rejectReadyWaiters(this.readyWaiters, error, generation);
    if (this.emitter.listenerCount("error") > 0) {
      this.emitter.emit("error", error);
    }
    this.emitter.emit("done", "process-close");
  }
  handleProcessError(error: Error, generation = this.generation): void {
    if (generation !== this.generation || this.phase === "dead") return;
    if (this.emitter.listenerCount("error") > 0) {
      this.emitter.emit("error", error);
    } else {
      logger.warn("Agda process error while transport was idle", { error: String(error) });
    }
  }
  /** Reset state and reject any waiting command. */
  destroy(): void {
    this.phase = "dead";
    this.clearControlEscalationTimer();
    this.framer.reset();
    this.buffer = "";
    this.responseQueue = [];
    this.collecting = false;
    this.currentCommandKind = null;
    this.outstandingRequest = false;
    this.uncertainControl = false;
    rejectReadyWaiters(
      this.readyWaiters,
      new Error("AgdaTransport destroyed while process was starting"),
      this.generation,
    );
    this.rejectInFlightCommand("AgdaTransport destroyed while command was in flight");
    this.activeProcess = null;
    this.emitter.emit("done", "process-close");
  }
  /** Interrupt an active ordinary command. */
  rejectInFlightCommand(
    reason: string,
    options: { controlCommand?: boolean } = {},
  ): boolean {
    if (this.emitter.listenerCount("error") === 0) return false;
    const error = options.controlCommand
      ? new ControlCommandInterruption(reason)
      : new Error(reason);
    this.emitter.emit("error", error);
    return true;
  }
  /** Write a control command; flush is only its no-op fallback. */
  sendFireAndForgetCommand(
    proc: ChildProcess,
    command: string,
    options: {
      flushMs?: number;
      escalationMs?: number;
      startupTimeoutMs?: number;
      armEscalation?: boolean;
    } = {},
  ): Promise<AgdaResponse[]> {
    const flushMs = options.flushMs ?? 250;
    const escalationMs = options.escalationMs ?? DEFAULT_CONTROL_ESCALATION_MS;
    const startupTimeoutMs = options.startupTimeoutMs ?? configuredCommandTimeoutMs();
    this.adoptDirectProcessIfNeeded(proc);
    if (this.uncertainControl && this.activeProcess === proc) {
      this.retireUncertainProcess(proc);
      return Promise.resolve([]);
    }
    this.rejectInFlightCommand(
      "Interrupted by Agda control command",
      { controlCommand: true },
    );
    const generation = this.generation;
    return new Promise<AgdaResponse[]>((resolve) => {
      let settled = false;
      let boundaryObserved = false;
      let flushTimer: NodeJS.Timeout | null = null;
      let startupTimer: NodeJS.Timeout | null = null;
      const settle = (responses = [...this.responseQueue]): void => {
        if (settled) return;
        settled = true;
        if (flushTimer) clearTimeout(flushTimer);
        if (startupTimer) clearTimeout(startupTimer);
        removeReadyWaiter(this.readyWaiters, begin, onReadyError, generation);
        this.collecting = false;
        this.currentCommandKind = null;
        if (this.phase !== "dead") this.phase = "ready";
        this.emitter.removeListener("error", onError);
        this.emitter.removeListener("frame", onFrame);
        resolve(responses);
      };
      const onError = (): void => settle();
      const onFrame = (responses: AgdaResponse[]): void => {
        boundaryObserved = true;
        this.uncertainControl = false;
        settle(responses);
      };
      const onFlush = (): void => {
        if (!boundaryObserved) this.uncertainControl = true;
        settle();
      };
      const begin = (): void => {
        if (settled) return;
        if (startupTimer) {
          clearTimeout(startupTimer);
          startupTimer = null;
        }
        this.framer.reset();
        this.buffer = "";
        this.responseQueue = [];
        this.collecting = true;
        this.phase = "running";
        this.currentCommandKind = "control";
        this.lastResponseAt = null;
        this.lastResponseKind = null;
        this.clearControlEscalationTimer();
        if (options.armEscalation === true && escalationMs > 0) {
          this.controlEscalationTimer = setTimeout(() => {
            this.controlEscalationTimer = null;
            if (proc.exitCode === null && proc.signalCode === null) {
              logger.warn("Control command not acknowledged; terminating proc", {
                command: command.slice(0, 120),
                escalationMs,
              });
              terminateAgdaProcess(proc);
            }
          }, escalationMs);
          this.controlEscalationTimer.unref();
          proc.once?.("close", () => this.clearControlEscalationTimer());
        }
        flushTimer = setTimeout(onFlush, flushMs);
        try {
          proc.stdin?.write(`${command}\n`);
        } catch {
          this.uncertainControl = true;
          settle();
        }
      };
      const onReadyError = (): void => settle();
      this.emitter.on("error", onError);
      this.emitter.on("frame", onFrame);
      startupTimer = setTimeout(() => {
        if (settled) return;
        this.phase = "dead";
        terminateAgdaProcess(proc);
        settle();
      }, startupTimeoutMs);
      waitUntilReady(
        this.readyWaiters, generation, this.generation, this.phase, begin, onReadyError,
      );
    });
  }
  sendCommand(
    proc: ChildProcess,
    command: string,
    timeoutMs = configuredCommandTimeoutMs(),
  ): Promise<AgdaResponse[]> {
    logger.trace("sendCommand", { command: command.slice(0, 200), timeoutMs });
    this.adoptDirectProcessIfNeeded(proc);
    const generation = this.generation;
    if (this.uncertainControl && this.activeProcess === proc) {
      this.retireUncertainProcess(proc);
      return Promise.reject(new Error(
        "Agda control command did not establish a synchronized stream boundary; process retired",
      ));
    }
    const startTime = Date.now();
    if (this.outstandingRequest) {
      return Promise.reject(new Error("AgdaTransport permits only one outstanding command"));
    }
    this.outstandingRequest = true;
    return new Promise<AgdaResponse[]>((resolve, reject) => {
      let settled = false;
      let waitingSentry: NodeJS.Timeout | null = null;
      const timeout = setTimeout(() => {
        if (settled) return;
        const responseKinds = summarizeResponseKinds(this.responseQueue);
        logger.warn("sendCommand timed out", {
          command: command.slice(0, 100),
          timeoutMs,
          responseCount: this.responseQueue.length,
          elapsedMs: Date.now() - startTime,
          lastResponseAt: this.lastResponseAt,
          lastResponseKind: this.lastResponseKind,
          responseKinds,
          responseTail: tailResponsePreview(this.responseQueue),
        });
        settled = true;
        removeReadyWaiter(this.readyWaiters, onReady, onReadyError, generation);
        this.collecting = false;
        this.currentCommandKind = null;
        this.outstandingRequest = false;
        this.phase = "dead";
        this.framer.reset();
        this.buffer = "";
        terminateAgdaProcess(proc);
        if (waitingSentry) clearInterval(waitingSentry);
        this.emitter.removeListener("done", onDone);
        this.emitter.removeListener("error", onError);
        reject(new Error(
          `sendCommand timed out after ${timeoutMs}ms ` +
          `(received ${this.responseQueue.length} responses: ${JSON.stringify(responseKinds)})`,
        ));
      }, timeoutMs);
      const finish = (handler: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.collecting = false;
        this.currentCommandKind = null;
        this.outstandingRequest = false;
        if (this.phase === "running") this.phase = "ready";
        if (waitingSentry) clearInterval(waitingSentry);
        this.emitter.removeListener("done", onDone);
        this.emitter.removeListener("error", onError);
        this.emitter.removeListener("frame", onFrame);
        handler();
      };
      const onDone = (): void => {
        finish(() => reject(new Error("Agda process closed before command prompt")));
      };
      const onError = (error: Error): void => {
        finish(() => reject(error));
      };
      const onFrame = (responses: AgdaResponse[]): void => {
        finish(() => resolve(responses));
      };
      const onReady = (): void => {
        if (settled) return;
        if (this.phase === "dead" || generation !== this.generation) {
          finish(() => reject(new Error("Agda process generation is no longer active")));
          return;
        }
        this.framer.reset();
        this.buffer = "";
        this.responseQueue = [];
        this.collecting = true;
        this.phase = "running";
        this.currentCommandKind = "regular";
        this.lastResponseAt = null;
        this.lastResponseKind = null;
        const sentryIntervalMs = configuredWaitingSentryMs();
        if (sentryIntervalMs > 0) {
          waitingSentry = setInterval(() => {
            logger.warn("sendCommand still waiting", {
              command: command.slice(0, 100),
              elapsedMs: Date.now() - startTime,
              responseCount: this.responseQueue.length,
              msSinceLastResponse: this.lastResponseAt === null
                ? null
                : Date.now() - this.lastResponseAt,
              lastResponseKind: this.lastResponseKind,
              responseKinds: summarizeResponseKinds(this.responseQueue),
              responseTail: tailResponsePreview(this.responseQueue),
            });
          }, sentryIntervalMs);
        }
        try {
          proc.stdin?.write(`${command}\n`);
        } catch (error) {
          onError(error instanceof Error ? error : new Error(String(error)));
        }
      };
      const onReadyError = (error: Error): void => {
        finish(() => reject(error));
      };
      this.emitter.on("done", onDone);
      this.emitter.on("error", onError);
      this.emitter.on("frame", onFrame);
      waitUntilReady(
        this.readyWaiters, generation, this.generation, this.phase, onReady, onReadyError,
      );
    });
  }
  private handleFrameEvent(event: StdoutFrameEvent, generation: number): void {
    if (generation !== this.generation) return;
    switch (event.type) {
      case "prompt":
        if (this.phase === "starting") {
          const fault = startupFailure(this.startupFault, this.startupResponses);
          if (fault) {
            this.phase = "dead";
            if (this.activeProcess) terminateAgdaProcess(this.activeProcess);
          } else {
            this.phase = "ready";
          }
          rejectReadyWaiters(this.readyWaiters, fault ?? undefined, generation);
          return;
        }
        if (this.phase === "running" && this.collecting) {
          const responses = [...this.responseQueue];
          const commandKind = this.currentCommandKind;
          this.collecting = false;
          this.currentCommandKind = null;
          this.phase = "ready";
          if (commandKind === "control") {
            this.uncertainControl = false;
            this.clearControlEscalationTimer();
          }
          this.emitter.emit("frame", responses);
        } else if (this.phase === "ready" && this.uncertainControl) {
          this.uncertainControl = false;
          this.clearControlEscalationTimer();
        }
        return;
      case "json":
        try {
          const response = decodeResponse(event.text);
          this.recordFrameResponse(response);
        } catch {
          this.recordFrameDiagnostic(`Malformed Agda JSON: ${event.text}`);
        }
        return;
      case "raw":
        this.recordFrameDiagnostic(event.text);
        return;
      case "malformed":
        this.recordFrameDiagnostic(event.text);
        return;
    }
  }
  private recordFrameResponse(response: AgdaResponse): void {
    if (this.phase === "starting") {
      this.startupResponses.push(response);
      return;
    }
    if (!this.collecting) return;
    if (
      this.currentCommandKind === "regular" &&
      CONTROL_RESPONSE_KINDS.has(response.kind)
    ) {
      return;
    }
    this.responseQueue.push(response);
    this.lastResponseAt = Date.now();
    this.lastResponseKind = response.kind;
  }
  private recordFrameDiagnostic(text: string): void {
    if (this.phase === "starting") {
      this.startupFault = new Error(text);
      return;
    }
    if (!this.collecting) return;
    this.recordResponse({ kind: "StderrOutput", text });
  }
  private recordResponse(response: AgdaResponse): void {
    if (!this.collecting) return;
    this.responseQueue.push(response);
    this.lastResponseAt = Date.now();
    this.lastResponseKind = response.kind;
  }
  private retireUncertainProcess(proc: ChildProcess): void {
    this.uncertainControl = false;
    this.phase = "dead";
    this.collecting = false;
    this.currentCommandKind = null;
    this.framer.reset();
    this.buffer = "";
    this.clearControlEscalationTimer();
    terminateAgdaProcess(proc);
  }
  private adoptDirectProcessIfNeeded(proc: ChildProcess): void {
    if (this.activeProcess === proc) return;
    if (this.activeProcess === null) {
      this.activeProcess = proc;
      this.generation += 1;
      this.phase = "ready";
      this.framer.reset();
      this.buffer = "";
      return;
    }
    this.attachProcess(proc);
  }
  private clearControlEscalationTimer(): void {
    if (this.controlEscalationTimer) {
      clearTimeout(this.controlEscalationTimer);
      this.controlEscalationTimer = null;
    }
  }
}
