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
  const lastCommandRef = useRef<"attack" | "dodge" | "bit-beast" | null>(null);
  const lastCommandAtRef = useRef(0);
  const lastTrashRef = useRef("");
  const lastTrashAtRef = useRef(0);
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
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const first = result?.[0];
        const transcript = (first?.transcript || "").trim();
        if (!transcript) {
          continue;
        }

        setLastTranscript(transcript);
        const intent = parseVoiceIntent(transcript);
        const now = Date.now();

        if (intent.type === "command") {
          const isDuplicateCommand =
            lastCommandRef.current === intent.command && now - lastCommandAtRef.current < 360;
          if (isDuplicateCommand) {
            continue;
          }

          lastCommandRef.current = intent.command;
          lastCommandAtRef.current = now;
          onCommand(intent.command);
          continue;
        }

        if (!result.isFinal) {
          continue;
        }

        const normalizedTrash = transcript
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (normalizedTrash.length < 8) {
          continue;
        }

        const isDuplicateTrash =
          normalizedTrash === lastTrashRef.current && now - lastTrashAtRef.current < 3200;
        if (isDuplicateTrash) {
          continue;
        }

        lastTrashRef.current = normalizedTrash;
        lastTrashAtRef.current = now;
        onTrashTalk(intent.text);
      }
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
