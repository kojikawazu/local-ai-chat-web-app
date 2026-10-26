'use client';

import { useEffect, useState } from 'react';

/**
 * Ollama の利用可能なモデル一覧と、選択中のモデルを管理するフック（#163 で `page.tsx` から切り出し）。
 *
 * マウント時に `/api/models` から一覧を取得し、まだ選んでいなければ既定のモデルを選ぶ。
 * 取得に失敗したときは一覧を空のままにする（チャットは既定のモデルで動く）。
 *
 * @returns `models` は利用可能なモデル名の一覧、`visionModels` は画像に対応したモデル名の一覧（#6。
 *   取得前・取得に失敗したときは分からないため `null`）、`selectedModel` は選択中のモデル名（取得前は空文字）、
 *   `setSelectedModel` はモデルを選ぶ関数
 */
export function useModels() {
  const [models, setModels] = useState<string[]>([]);
  const [visionModels, setVisionModels] = useState<string[] | null>(null);
  const [selectedModel, setSelectedModel] = useState('');

  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await fetch('/api/models');
        if (!res.ok) return;
        const data = await res.json();
        setModels(data.models);
        setVisionModels(data.visionModels);
        setSelectedModel((current) => current || data.defaultModel);
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
    }
    fetchModels();
  }, []);

  return { models, visionModels, selectedModel, setSelectedModel };
}
