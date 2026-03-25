import type { AgdaResponse } from "../../agda/types.js";
import { extractMessage } from "../../agda/response-parsing.js";

export interface DecodedGoalDisplay {
    goalType: string;
    context: string[];
    auxiliary: string;
}

function splitSections(text: string): string[] {
    return text
        .split(/————+/)
        .map((section) => section.trim())
        .filter(Boolean);
}

function decodeContextEntries(entries: unknown[]): string[] {
    const context: string[] = [];

    for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;

        const record = entry as Record<string, unknown>;
        const name = typeof record.reifiedName === "string"
            ? record.reifiedName
            : typeof record.originalName === "string"
                ? record.originalName
                : "_";
        const binding = typeof record.binding === "string" ? record.binding : "?";

        context.push(`${name} : ${binding}`);
    }

    return context;
}

export function decodeGoalDisplayResponses(responses: AgdaResponse[]): DecodedGoalDisplay {
    let goalType = "";
    let auxiliary = "";
    const context: string[] = [];

    for (const resp of responses) {
        if (resp.kind !== "DisplayInfo") continue;

        const info = resp.info as Record<string, unknown> | undefined;
        if (!info) continue;

        if (info.kind === "Context" && Array.isArray(info.context)) {
            context.push(...decodeContextEntries(info.context));
            continue;
        }

        if (info.kind === "GoalType") {
            // Agda 2.8+ sends structured GoalType with type/entries fields
            if (typeof info.type === "string") {
                goalType = info.type;
                // Extract context from entries if present
                if (Array.isArray(info.entries) && context.length === 0) {
                    context.push(...decodeContextEntries(info.entries));
                }
            } else {
                goalType = extractMessage(info);
            }
            continue;
        }

        if (info.kind !== "GoalSpecific") continue;

        const goalInfo = info.goalInfo as Record<string, unknown> | undefined;
        if (!goalInfo) continue;

        // Agda 2.8+: GoalSpecific wraps a structured GoalType with type/entries
        if (goalInfo.kind === "GoalType" && typeof goalInfo.type === "string") {
            goalType = goalInfo.type;
            if (Array.isArray(goalInfo.entries) && context.length === 0) {
                context.push(...decodeContextEntries(goalInfo.entries));
            }
            continue;
        }

        const fullText = extractMessage(goalInfo);
        const sections = splitSections(fullText);

        if (sections.length >= 2 && context.length === 0) {
            context.push(...sections[0].split("\n").map((line) => line.trim()).filter(Boolean));
            goalType = sections[1] ?? goalType;
            auxiliary = sections.slice(2).join("\n\n") || auxiliary;
            continue;
        }

        if (!goalType) {
            goalType = fullText;
        } else if (!auxiliary) {
            auxiliary = fullText;
        }
    }

    return { goalType, context, auxiliary };
}
