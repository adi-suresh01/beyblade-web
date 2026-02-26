import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BEYBLADES } from "@/lib/game/beyblades";
import {
  getOrCreateVoiceSession,
  isLikelySpeakerEcho,
  isRecentHeardDuplicate,
  recordHeardText,
  resolveVoiceSessionKey,
  trimVoiceHistory
} from "@/lib/server/voiceSession";

const bodySchema = z.object({
  playerText: z.string().min(1).max(400),
  playerBlade: z.enum(["dragoon", "dranzer", "draciel", "driger"]),
  aiBlade: z.enum(["dragoon", "dranzer", "draciel", "driger"]),
  context: z.string().max(120).optional(),
  sessionId: z.string().min(1).max(80).optional()
});

const fallbackLines = [
  "You talk big, but your launch timing is a public service announcement for failure.",
  "If confidence was damage, you'd still miss from this range.",
  "Even your Bit Beast looked away before that move landed.",
  "You're not outplayed, you're outclassed in real time.",
  "Keep talking. Your voice does more spinning than your Beyblade."
];

function randomFallback(): string {
  return fallbackLines[Math.floor(Math.random() * fallbackLines.length)];
}

function extractResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const asRecord = payload as Record<string, unknown>;
  if (typeof asRecord.output_text === "string" && asRecord.output_text.trim()) {
    return asRecord.output_text.trim();
  }

  const output = asRecord.output;
  if (!Array.isArray(output)) {
    return null;
  }

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const piece of content) {
      if (!piece || typeof piece !== "object") {
        continue;
      }

      const text = (piece as Record<string, unknown>).text;
      if (typeof text === "string") {
        chunks.push(text);
      }
    }
  }

  const combined = chunks.join(" ").trim();
  return combined || null;
}

async function generateRoastWithModel(input: {
  playerText: string;
  playerBlade: keyof typeof BEYBLADES;
  aiBlade: keyof typeof BEYBLADES;
  context?: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const systemPrompt = [
    "You are a ruthless but PG-13 Beyblade rival delivering concise comebacks.",
    "Style: sharp, confident, witty. No slurs, no hate speech, no threats.",
    "Always return one line, <= 22 words."
  ].join(" ");

  const userPrompt = [
    `Player Beyblade: ${BEYBLADES[input.playerBlade].name}`,
    `AI Beyblade: ${BEYBLADES[input.aiBlade].name}`,
    input.context ? `Context: ${input.context}` : "",
    `Player says: "${input.playerText}"`,
    "Return only the roast line."
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 1,
      max_output_tokens: 80,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: userPrompt }]
        }
      ]
    })
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as unknown;
  return extractResponseText(payload);
}

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const sessionKey = resolveVoiceSessionKey(parsed.data.sessionId, request.headers);
  const session = getOrCreateVoiceSession(sessionKey);
  trimVoiceHistory(session);

  if (isRecentHeardDuplicate(session, parsed.data.playerText, 2600)) {
    return NextResponse.json({
      roast: " ",
      suppressed: true,
      reason: "duplicate-player-input"
    });
  }

  if (isLikelySpeakerEcho(session, parsed.data.playerText)) {
    return NextResponse.json({
      roast: " ",
      suppressed: true,
      reason: "speaker-echo"
    });
  }

  recordHeardText(session, parsed.data.playerText, "player");

  const roast =
    (await generateRoastWithModel(parsed.data).catch(() => null)) || randomFallback();

  return NextResponse.json({
    roast
  });
}
