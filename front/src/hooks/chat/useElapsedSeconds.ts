'use client';

import { useEffect, useState } from 'react';

/** 経過時間を数え直す間隔（ミリ秒）。秒で出すため 1 秒ごと */
const TICK_MS = 1_000;

/**
 * 使い始めてからの経過秒数を返す（サブエージェントに任せている間の表示。#26）。
 *
 * 部品が画面に出た時点から数える。数え直すのは 1 秒ごと。
 *
 * @returns 経過した秒数（切り捨て）
 */
export function useElapsedSeconds(): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);
  return elapsed;
}
