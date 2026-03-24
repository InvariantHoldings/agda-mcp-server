export type SessionPhase =
  | "idle"
  | "starting"
  | "ready"
  | "loaded"
  | "busy"
  | "exiting";

export interface SessionStateSnapshot {
  hasProcess: boolean;
  hasLoadedFile: boolean;
  isCollecting: boolean;
  isExiting: boolean;
}

export function deriveSessionPhase(snapshot: SessionStateSnapshot): SessionPhase {
  if (snapshot.isExiting) {
    return "exiting";
  }

  if (snapshot.isCollecting) {
    return "busy";
  }

  if (snapshot.hasLoadedFile) {
    return "loaded";
  }

  if (snapshot.hasProcess) {
    return "ready";
  }

  return "idle";
}
