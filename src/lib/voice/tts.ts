"use client";

let queue = Promise.resolve();

interface SpeakParams {
  text: string;
  voiceId: string;
}

export function speakText(params: SpeakParams): Promise<void> {
  queue = queue.then(() => doSpeak(params)).catch(() => undefined);
  return queue;
}

async function doSpeak({ text, voiceId }: SpeakParams): Promise<void> {
  if (!text.trim() || !voiceId.trim()) {
    return;
  }

  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId })
  });

  if (!response.ok) {
    throw new Error("Failed to synthesize voice");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  try {
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
