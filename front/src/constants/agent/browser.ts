import type { ToolDefinition } from '@/lib/agent/tools/types';

/**
 * ブラウザのツール（#149。`docs/18-browser-tools.md`）で複数のファイルから使う値。
 */

/** ページの大きさ。スクリーンショットは約 1,000 トークンになる（`docs/18-browser-tools.md`「前提の調査」） */
export const BROWSER_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * スナップショットの 1 回の文字数の上限。`read_file` と同じ（約 4,000 トークン・読むのに 30 秒程度。
 * `docs/18-browser-tools.md`「上限値」）
 */
export const MAX_SNAPSHOT_CHARS = 12_000;

/** プロキシが止めた HTTP のリクエストに付けるヘッダー。ブラウザのツールが、ページを止めた理由を読むのに使う */
export const BROWSER_BLOCKED_HEADER = 'x-browser-tool-blocked';

/** ブラウザのツールが、エージェントループの外から（応答ごとの文脈なしで）呼ばれたときの理由 */
export const BROWSER_NO_CONTEXT_REASON =
  'ブラウザのツールはエージェントの応答の中でだけ使えます';

/**
 * ブラウザのツールの順に実行する組の名前（`Tool` の `exclusive`。#149 Phase C）。6 つのツールが 1 つのページを共有するため、
 * 同じ応答の中では呼ばれた順に 1 つずつ実行する
 */
export const BROWSER_EXCLUSIVE = 'browser';

/** ページをまだ開いていないときの理由（読み直し・スクリーンショット・操作で共通） */
export const BROWSER_NOT_OPENED_REASON =
  '先に browser_navigate でページを開いてください';

/**
 * ページを開いた後・操作の後に、ネットワークが落ち着くのを待つ時間（ミリ秒）。SPA の描画・操作の結果の表示を待つ。
 * ポーリングするページで、ツール全般の上限（既定 30 秒）を使い切らない
 */
export const BROWSER_SETTLE_TIMEOUT_MS = 2_000;

/**
 * 要素が操作できる（表示され、有効になる）まで待つ時間（ミリ秒。#149 Phase C）。ツール全般の上限（既定 30 秒）の中に、
 * 落ち着くのを待つ時間とスナップショットを収める（`docs/18-browser-tools.md`「Phase C の上限値」）
 */
export const BROWSER_ACTION_TIMEOUT_MS = 5_000;

/** 操作のツールの `ref` 引数の定義（`browser_click`・`browser_type`・`browser_select` で共通。#149 Phase C） */
export const REF_PARAM: ToolDefinition['parameters']['properties'][string] = {
  type: 'string',
  description:
    '操作する要素の参照（ページの内容の [ref=e12] の e12。iframe の中は f1e3 の形）',
};

/**
 * 利用者へ見せるスクリーンショット（操作の前・後、ページを開いた後。#200）の JPEG の品質。
 * PNG の 6 割程度の大きさで、文字は読める（`docs/18-browser-tools.md`「画面の表示の前提の調査」）
 */
export const BROWSER_SCREENSHOT_JPEG_QUALITY = 70;

/**
 * スクリーンショットを撮るのに待つ時間（ミリ秒）。`browser_screenshot` と、利用者へ見せる画面（#200）で共通
 */
export const BROWSER_SCREENSHOT_TIMEOUT_MS = 10_000;
