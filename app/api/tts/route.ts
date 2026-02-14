import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  text: z.string().min(1).max(300),
  voiceId: z.string().min(1)
});

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing ELEVENLABS_API_KEY" }, { status: 500 });
  }

  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

  const upstream = await fetch(`${ELEVENLABS_API_URL}/${parsed.data.voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model_id: modelId,
      text: parsed.data.text,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.7,
        style: 0.85,
        use_speaker_boost: true
      }
    })
  });

  if (!upstream.ok) {
    const message = await upstream.text();
    return NextResponse.json(
      {
        error: "ElevenLabs request failed",
        details: message.slice(0, 200)
      },
      { status: 502 }
    );
  }

  const audioBuffer = await upstream.arrayBuffer();

  return new NextResponse(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store"
    }
  });
}
