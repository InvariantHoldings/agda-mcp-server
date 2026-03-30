import type { AgdaResponse } from "../../agda/types.js";
import {
  contextEntrySchema,
  contextInfoSchema,
  goalTypeInfoSchema,
  parseResponseWithSchema,
} from "../response-schemas.js";
import { decodeDisplayInfoEvents } from "./display-info.js";

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
        const parsed = contextEntrySchema.safeParse(entry);
        if (!parsed.success) continue;

        const record = parsed.data;
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

    for (const event of decodeDisplayInfoEvents(responses)) {
        const contextInfo = parseResponseWithSchema(contextInfoSchema, event.payload);
        if (contextInfo) {
            context.push(...decodeContextEntries(contextInfo.context));
            continue;
        }

        const goalTypeInfo = parseResponseWithSchema(goalTypeInfoSchema, event.payload);
        if (goalTypeInfo) {
            if (goalTypeInfo.type) {
                goalType = goalTypeInfo.type;
                if (Array.isArray(goalTypeInfo.entries) && context.length === 0) {
                    context.push(...decodeContextEntries(goalTypeInfo.entries));
                }
            } else if (event.text) {
                goalType = event.text;
            }
            continue;
        }

        const fullText = event.text;
        const sections = splitSections(fullText);

        if (sections.length >= 2 && context.length === 0) {
            context.push(...sections[0].split("\n").map((line) => line.trim()).filter(Boolean));
            goalType = sections[1] ?? goalType;
            auxiliary = sections.slice(2).join("\n\n") || auxiliary;
            continue;
        }

        if (fullText && !goalType) {
            goalType = fullText;
        } else if (fullText && !auxiliary) {
            auxiliary = fullText;
        }
    }

    return { goalType, context, auxiliary };
}
