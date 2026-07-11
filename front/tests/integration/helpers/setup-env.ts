import { inject } from 'vitest';

// テストファイル（および '@/lib/prisma' の singleton）が読み込まれる前に、
// globalSetup が Testcontainers から払い出した接続先を DATABASE_URL に設定する。
// これにより route handler が経由する prisma が使い捨てコンテナ DB に接続する。
process.env.DATABASE_URL = inject('DATABASE_URL');
