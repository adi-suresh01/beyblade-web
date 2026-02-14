"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseVoiceIntent } from "@/lib/voice/intent";

interface UseSpeechCommandParams {
  onCommand: (command: "attack" | "dodge" | "bit-beast") => void;
  onTrashTalk: (text: string) => void;
}

type SpeechRecognitionCtor = typeof window.SpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window.SpeechRecognition ||
    (window as typeof window & { webkitSpeechRecognition?: SpeechRecognitionCtor })
      .webkitSpeechRecognition) as SpeechRecognitionCtor | undefined;
}

export function useSpeechCommand({
  onCommand,
  onTrashTalk
}: UseSpeechCommandParams) {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const supported = useMemo(() => Boolean(getSpeechRecognitionCtor()), []);

  const start = useCallback(() => {
    if (isListening) {
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("SpeechRecognition is not available in this browser.");
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new Ctor();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognitionRef.current = recognition;
    }

    const recognition = recognitionRef.current;
    if (!recognition) {
      return;
    }

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event) => {
      setError(event.error || "Speech recognition error");
    };

    recognition.onresult = (event) => {
      const results = Array.from(event.results)
        .slice(event.resultIndex)
        .map((result) => {
          const first = result[0];
          return first?.transcript ?? "";
        })
        .join(" ")
        .trim();

      if (!results) {
        return;
      }

      setLastTranscript(results);
      const intent = parseVoiceIntent(results);
      if (intent.type === "command") {
        onCommand(intent.command);
        return;
      }

      onTrashTalk(intent.text);
    };

    try {
      recognition.start();
    } catch (error) {
      if (
        error instanceof Error &&
        /already started|start/i.test(error.message)
      ) {
        return;
      }
      const message =
        error instanceof Error ? error.message : "Unable to start speech recognition";
      setError(message);
    }
  }, [isListening, onCommand, onTrashTalk]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  return {
    supported,
    isListening,
    lastTranscript,
    error,
    start,
    stop
  };
}
