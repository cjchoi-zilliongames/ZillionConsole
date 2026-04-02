"use client";

import { useRef, useState } from "react";
import type { ConflictResolution } from "./useStorageService";

/**
 * Async conflict-resolution prompt.
 * Call `askConflict(fileName)` to show the dialog and await the user's decision.
 * The dialog calls `resolveConflict(resolution, applyAll)` to complete the promise.
 */
export function useConflictResolver() {
  const [conflictFile, setConflictFile] = useState<string | null>(null);
  const [conflictApplyAll, setConflictApplyAll] = useState(false);
  const resolverRef = useRef<((r: ConflictResolution) => void) | null>(null);
  const applyAllDecisionRef = useRef<ConflictResolution | null>(null);

  function askConflict(fileName: string): Promise<ConflictResolution> {
    if (applyAllDecisionRef.current) {
      return Promise.resolve(applyAllDecisionRef.current);
    }
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setConflictApplyAll(false);
      setConflictFile(fileName);
    });
  }

  function resolveConflict(resolution: ConflictResolution, applyAll: boolean) {
    if (applyAll) applyAllDecisionRef.current = resolution;
    setConflictFile(null);
    resolverRef.current?.(resolution);
    resolverRef.current = null;
  }

  function resetApplyAll() {
    applyAllDecisionRef.current = null;
  }

  return {
    conflictFile,
    conflictApplyAll,
    setConflictApplyAll,
    askConflict,
    resolveConflict,
    resetApplyAll,
  };
}
