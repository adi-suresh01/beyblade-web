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

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j < cols; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function similarEnough(source: string, target: string, threshold: number): boolean {
  if (!source || !target) {
    return false;
  }

  const distance = levenshteinDistance(source, target);
  const longest = Math.max(source.length, target.length);
  const similarity = 1 - distance / longest;
  return similarity >= threshold;
}

function phraseMatches(transcript: string, expectedPhrase: string): boolean {
  if (!transcript || !expectedPhrase) {
    return false;
  }

  if (transcript.includes(expectedPhrase)) {
    return true;
  }

  if (expectedPhrase === "let it rip") {
    const quickVariants = [
      "let it trip",
      "let a rip",
      "let er rip",
      "let her rip",
      "lit it rip",
      "let rip"
    ];

    if (quickVariants.some((variant) => transcript.includes(variant))) {
      return true;
    }
  }

  const transcriptWords = transcript.split(" ").filter(Boolean);
  const expectedWords = expectedPhrase.split(" ").filter(Boolean);

  if (!transcriptWords.length || !expectedWords.length) {
    return false;
  }

  const minWindow = Math.max(1, expectedWords.length - 1);
  const maxWindow = expectedWords.length + 1;

  for (let size = minWindow; size <= maxWindow; size += 1) {
    for (let i = 0; i + size <= transcriptWords.length; i += 1) {
      const segment = transcriptWords.slice(i, i + size).join(" ");
      if (similarEnough(segment, expectedPhrase, 0.62)) {
        return true;
      }
    }
  }

  return false;
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
      if (phraseMatches(normalized, expectedPhrase)) {
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
