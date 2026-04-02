"use client";

import { useState } from "react";

import { ChartMemosConflictError, type ChartMemos } from "@/lib/spec/chart-memos";
import type { StorageService } from "./useStorageService";

export function useChartMemos(service: StorageService) {
  const [memos, setMemos] = useState<ChartMemos>({});
  const [generation, setGeneration] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  async function load() {
    try {
      const snap = await service.getChartMemos();
      setMemos(snap.memos);
      setGeneration(snap.generation);
    } catch {
      /* 메모 로드 실패는 무시 */
    }
  }

  async function save(key: string, memo: string) {
    const trimmed = memo.trim();
    const prevMemos = memos;
    setMemos((prev) => {
      const next = { ...prev };
      if (trimmed) next[key] = trimmed; else delete next[key];
      return next;
    });
    try {
      const { generation: nextGen } = await service.saveChartMemo(key, trimmed, generation);
      setGeneration(nextGen);
    } catch (e) {
      setMemos(prevMemos);
      if (e instanceof ChartMemosConflictError) void load();
    }
  }

  function startEdit(key: string, currentValue: string) {
    setEditingKey(key);
    setEditingValue(currentValue);
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditingValue("");
  }

  return {
    memos,
    setMemos,
    editingKey,
    editingValue,
    setEditingValue,
    load,
    save,
    startEdit,
    cancelEdit,
  };
}
