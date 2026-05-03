import OpenAI from "openai";

const baseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!baseURL || !apiKey) {
    throw new Error(
      "OpenAI integration is not configured. Missing AI_INTEGRATIONS_OPENAI_BASE_URL or AI_INTEGRATIONS_OPENAI_API_KEY.",
    );
  }
  if (!client) {
    client = new OpenAI({ apiKey, baseURL });
  }
  return client;
}

export type AiAction =
  | { type: "answer"; text: string }
  | { type: "tool"; tool: string; args: Record<string, unknown>; rationale: string };

const SYSTEM_PROMPT = `You are the Replit-AI command interpreter for QueenSync — the
control plane for the Kannaka constellation (a swarm of agentic "arms" plus
the Radio and Observatory broadcast services). The operator types natural
language into a terminal command bar. Your job: pick the single best action.

Available tools (return tool name exactly):
- list_arms              → list every Kannaka arm and its status
- list_tasks             → list recent tasks
- list_signals           → list recent inbound signals
- list_logs              → list recent log entries
- list_memory            → list memory events (args: { includeCompacted?: boolean })
- list_resonance         → list resonance fields (args: { activeOnly?: boolean })
- list_adapters_health   → adapter health for radio + observatory
- system_summary         → high-level health snapshot
- observatory_state      → live HRM / consciousness snapshot
- wake_kannaktopus       → wake the kannaktopus swarm
- dream_lite             → trigger a Dream-Lite memory compaction
- resonance_storm        → fire a demo resonance storm
- create_signal          → inject a signal (args: { type: string, source?: string, payload?: object })
- add_monitor            → add a monitor tile to the wall (args: { kind: "radio-hologram"|"observatory"|"logs"|"arms"|"resonance"|"tasks"|"signals"|"memory-stream"|"hrm-stats"|"adapters"|"iframe", url?: string, title?: string })
- remove_monitor         → remove a monitor (args: { kind?: string, title?: string })
- clear_monitors         → remove every monitor

If the request is conversational, informational, or doesn't match a tool,
return an "answer" with a short helpful response (1–3 sentences, terminal
style, no markdown).

ALWAYS reply with a JSON object matching one of:
  { "type": "tool",   "tool": "<name>", "args": {...}, "rationale": "<short>" }
  { "type": "answer", "text": "<short answer>" }

No prose outside the JSON.`;

export async function interpretCommand(prompt: string): Promise<AiAction> {
  const openai = getClient();
  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 600,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  const content = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!content) {
    return { type: "answer", text: "(no response)" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { type: "answer", text: content };
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "type" in parsed &&
    (parsed as { type: string }).type === "tool" &&
    typeof (parsed as { tool?: unknown }).tool === "string"
  ) {
    const p = parsed as unknown as {
      tool: string;
      args?: Record<string, unknown>;
      rationale?: string;
    };
    return {
      type: "tool",
      tool: p.tool,
      args: p.args ?? {},
      rationale: p.rationale ?? "",
    };
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "type" in parsed &&
    (parsed as { type: string }).type === "answer"
  ) {
    const text = (parsed as { text?: unknown }).text;
    return { type: "answer", text: typeof text === "string" ? text : content };
  }

  return { type: "answer", text: content };
}

export function isAiConfigured(): boolean {
  return Boolean(baseURL && apiKey);
}
