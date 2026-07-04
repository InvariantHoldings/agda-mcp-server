// MIT License — see LICENSE
//
// Tracks whether a Cmd_load's goal-state terminus has arrived on the
// response stream. A finished load always emits InteractionPoints AND
// AllGoalsWarnings (order varies across Agda versions), or a DisplayInfo
// Error on failure. The transport uses `reached()` to withhold idle
// completion until then, so a slow module's silent type-checking gap
// can't be mistaken for the end of the command.
//
// A fatal protocol stderr (Agda rejecting the command it "cannot read")
// is also a terminus: Agda keeps running but emits no goal state, so
// without this the load would wait the full command timeout.

import type { AgdaResponse } from "../agda/types.js";
import { isFatalProtocolStderr } from "../agda/protocol-errors.js";

export class GoalTerminusTracker {
  private sawInteractionPoints = false;
  private sawAllGoalsWarnings = false;
  private sawError = false;
  private sawFatalStderr = false;

  reset(): void {
    this.sawInteractionPoints = false;
    this.sawAllGoalsWarnings = false;
    this.sawError = false;
    this.sawFatalStderr = false;
  }

  /** Record one response via cheap kind reads (no schema parse). */
  record(response: AgdaResponse): void {
    if (response.kind === "InteractionPoints") {
      this.sawInteractionPoints = true;
    } else if (response.kind === "DisplayInfo") {
      const infoKind = (response.info as { kind?: unknown } | undefined)?.kind;
      if (infoKind === "AllGoalsWarnings") this.sawAllGoalsWarnings = true;
      else if (infoKind === "Error") this.sawError = true;
    } else if (response.kind === "StderrOutput") {
      const text = (response as { text?: unknown }).text;
      if (typeof text === "string" && isFatalProtocolStderr(text)) {
        this.sawFatalStderr = true;
      }
    }
  }

  reached(): boolean {
    return (
      this.sawError ||
      this.sawFatalStderr ||
      (this.sawInteractionPoints && this.sawAllGoalsWarnings)
    );
  }
}
