"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SpeechRecognitionCtor = typeof window.SpeechRecognition;

interface UseSpeechPhraseParams {
  phrase: string;
  onMatch: (heardText: string) => void;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window.SpeechRecognition ||
    (window as typeof window & { webkitSpeechRecognition?: SpeechRecognitionCtor })
      .webkitSpeechRecognition) as SpeechRecognitionCtor | undefined;
}

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function useSpeechPhrase({ phrase, onMatch }: UseSpeechPhraseParams) {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const expectedPhrase = useMemo(() => normalize(phrase), [phrase]);
  const supported = useMemo(() => Boolean(getSpeechRecognitionCtor()), []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("SpeechRecognition is not available in this browser.");
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new Ctor();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = false;
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
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();

      if (!results) {
        return;
      }

      setLastTranscript(results);
      const normalized = normalize(results);
      if (normalized.includes(expectedPhrase)) {
        onMatch(results);
        recognition.stop();
      }
    };

    try {
      recognition.start();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start phrase detection";
      setError(message);
    }
  }, [expectedPhrase, onMatch]);

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
