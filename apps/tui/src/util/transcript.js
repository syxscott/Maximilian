import { Locale } from "./locale";
import * as Model from "./model";
export function formatTranscript(session, messages, options) {
    const providers = Model.index(options.providers);
    let transcript = `# ${session.title}\n\n`;
    transcript += `**Session ID:** ${session.id}\n`;
    transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`;
    transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`;
    transcript += `---\n\n`;
    for (const msg of messages) {
        transcript += formatMessage(msg.info, msg.parts, options, providers);
        transcript += `---\n\n`;
    }
    return transcript;
}
export function formatMessage(msg, parts, options, providers) {
    let result = "";
    if (msg.role === "user") {
        result += `## User\n\n`;
    }
    else {
        result += formatAssistantHeader(msg, options.assistantMetadata, providers ?? options.providers);
    }
    for (const part of parts) {
        result += formatPart(part, options);
    }
    return result;
}
export function formatAssistantHeader(msg, includeMetadata, providers) {
    if (!includeMetadata) {
        return `## Assistant\n\n`;
    }
    const duration = msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : "";
    const modelName = Model.name(providers, msg.providerID, msg.modelID);
    return `## Assistant (${Locale.titlecase(msg.agent)} · ${modelName}${duration ? ` · ${duration}` : ""})\n\n`;
}
export function formatPart(part, options) {
    if (part.type === "text" && !part.synthetic) {
        return `${part.text}\n\n`;
    }
    if (part.type === "reasoning") {
        if (options.thinking) {
            return `_Thinking:_\n\n${part.text}\n\n`;
        }
        return "";
    }
    if (part.type === "tool") {
        let result = `**Tool: ${part.tool}**\n`;
        if (options.toolDetails && part.state.input) {
            result += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\`\n`;
        }
        if (options.toolDetails && part.state.status === "completed" && part.state.output) {
            result += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\`\n`;
        }
        if (options.toolDetails && part.state.status === "error" && part.state.error) {
            result += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\`\n`;
        }
        result += `\n`;
        return result;
    }
    return "";
}
