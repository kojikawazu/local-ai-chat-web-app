const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3.8:27b';
// RAG のドキュメントの埋め込みのモデル（#17）。日本語の docs で比べていちばんよかったもの（docs/28-rag.md「前提の調査」）
const OLLAMA_DEFAULT_EMBED_MODEL =
  process.env.OLLAMA_EMBED_MODEL || 'embeddinggemma:300m';

import type {
  OllamaToolDefinition,
  OllamaToolCall,
} from '@/lib/agent/tools/types';

/**
 * Ollama `/api/chat` に送受信する 1 件のチャットメッセージ。
 */
export interface OllamaChatMessage {
  /** メッセージの発話主体。`tool` はツール実行結果、`system` はシステムプロンプト */
  role: 'user' | 'assistant' | 'tool' | 'system';
  /** メッセージ本文。ツール呼び出し要求時は空文字になり得る */
  content: string;
  /** assistant がツール呼び出しを要求するときに設定される（それ以外は未設定） */
  tool_calls?: OllamaToolCall[];
  /**
   * 添付画像（`data:` の接頭辞なしの Base64。#6）。画像に対応したモデルだけが受け付け、
   * 対応していないモデルに送ると Ollama は 400 を返す
   */
  images?: string[];
}

/**
 * Ollama ストリーミング応答（NDJSON）の 1 チャンク。
 */
export interface OllamaStreamChunk {
  /** 応答を生成したモデル名 */
  model: string;
  /** このチャンクが運ぶメッセージ断片 */
  message: {
    /** メッセージの発話主体（通常は `assistant`） */
    role: string;
    /** このチャンク分のテキスト断片（逐次連結して本文を構成する） */
    content: string;
    /** ツール呼び出し要求（通常は `done=true` のチャンクに含まれる） */
    tool_calls?: OllamaToolCall[];
    /**
     * このチャンク分の思考過程の断片。思考に対応したモデル（`qwen3.8` 等）が本文とは別に返す。
     * 本文中に `<think>` タグで思考を書くモデルでは未設定
     */
    thinking?: string;
  };
  /** ストリームの終端チャンクなら true */
  done: boolean;
  /** 入力のトークン数（終端チャンクだけ。キャッシュの分を含む。#31） */
  prompt_eval_count?: number;
  /** 入力のうちキャッシュから読んだトークン数（終端チャンクだけ。#31） */
  prompt_eval_cached_count?: number;
  /** 入力の処理の時間（ナノ秒。終端チャンクだけ。#31） */
  prompt_eval_duration?: number;
  /** 出力のトークン数（終端チャンクだけ。思考のトークンを含む。#31） */
  eval_count?: number;
  /** 出力の生成の時間（ナノ秒。終端チャンクだけ。#31） */
  eval_duration?: number;
  /** モデルの読み込みの時間（ナノ秒。終端チャンクだけ。#31） */
  load_duration?: number;
  /** Ollama の中の時間の合計（ナノ秒。終端チャンクだけ。#31） */
  total_duration?: number;
}

/**
 * Ollama `/api/chat` へのリクエストに付けるオプション。
 */
export type OllamaChatOptions = {
  /**
   * 思考させるか。`false` で思考を止めて最初の本文を速く返させる。未指定ならモデルの既定に従う。
   * 思考に対応していないモデルへ `true` を送ると Ollama がエラーを返すため、送るのは `false` に限る想定
   */
  think?: boolean;
  /**
   * 中断の信号。abort されると Ollama への接続を切り、Ollama 側の生成も止める（Ollama は
   * 接続が切れると生成を止める）。ブラウザが停止・切断したときに生成を続けさせないため
   */
  signal?: AbortSignal;
  /**
   * 生成するトークン数の上限（Ollama の `options.num_predict`）。未指定なら上限なし。
   * 短い出力しか要らない用途で、小さいモデルが指示を外れて書き続け、Ollama を数分占有して
   * 後続の生成を待たせるのを防ぐ
   */
  maxTokens?: number;
};

/**
 * {@link OllamaChatOptions} のうち、Ollama のモデルの実行オプション（`options`）に当たるものを組み立てる。
 *
 * @param options - リクエストのオプション
 * @returns リクエストボディに足す `options`。指定が無ければ空オブジェクト（ボディに足さない）
 */
function modelOptions(options: OllamaChatOptions): Record<string, unknown> {
  return options.maxTokens !== undefined
    ? { options: { num_predict: options.maxTokens } }
    : {};
}

/**
 * Ollama にインストール済みのモデル情報（`/api/tags` の 1 要素）。
 */
export interface OllamaModel {
  /** モデル名（例: `qwen3.8:27b`）。切替やリクエスト指定に使う */
  name: string;
  /** モデルの最終更新日時（ISO 文字列） */
  modified_at: string;
  /** モデルのファイルサイズ（バイト） */
  size: number;
}

/**
 * Ollama にインストール済みのモデル一覧を取得する。
 *
 * @returns 利用可能なモデルの配列。モデルが無ければ空配列
 * @throws {Error} Ollama API が非 2xx を返した場合
 */
export async function listModels(): Promise<OllamaModel[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.models ?? [];
}

/** モデルが画像入力に対応していることを表す、`/api/show` の `capabilities` の値。 */
const VISION_CAPABILITY = 'vision';

/**
 * モデルの対応機能（`/api/show` の `capabilities`）を取得する（#6）。
 *
 * `/api/tags` の一覧には対応機能が含まれないため、モデルごとに問い合わせる。
 *
 * @param model - 対象のモデル名。未指定時はデフォルトモデル
 * @returns 対応機能の名前（`completion`・`vision`・`tools`・`thinking` 等）。Ollama が返さなければ空配列
 * @throws {Error} Ollama API が非 2xx を返した場合（存在しないモデルを含む）
 */
export async function getModelCapabilities(model?: string): Promise<string[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || OLLAMA_DEFAULT_MODEL }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  const data: unknown = await response.json();
  const capabilities =
    typeof data === 'object' && data !== null && 'capabilities' in data
      ? data.capabilities
      : undefined;
  return Array.isArray(capabilities)
    ? capabilities.filter((c): c is string => typeof c === 'string')
    : [];
}

/**
 * モデルが画像入力に対応しているかを返す（#6）。
 *
 * @param model - 対象のモデル名。未指定時はデフォルトモデル
 * @returns `capabilities` に `vision` があれば true
 * @throws {Error} Ollama API が非 2xx を返した場合
 */
export async function supportsVision(model?: string): Promise<boolean> {
  return (await getModelCapabilities(model)).includes(VISION_CAPABILITY);
}

/**
 * 環境変数 `OLLAMA_MODEL` で決まるデフォルトモデル名を返す。
 *
 * @returns デフォルトモデル名（未設定時は `qwen3.8:27b`）
 */
export function getDefaultModel(): string {
  return OLLAMA_DEFAULT_MODEL;
}

/**
 * 会話履歴の先頭にシステムプロンプトを付ける。通常チャットとエージェントで同じ付け方にする（#10）。
 *
 * @param messages - 会話履歴（user / assistant / tool を時系列で並べる）
 * @param systemPrompt - 付けるシステムプロンプト。前後の空白は除く
 * @returns 先頭に system メッセージを足した新しい配列。空・空白のみ・未指定なら元の内容のまま（複製）
 */
export function withSystemPrompt(
  messages: OllamaChatMessage[],
  systemPrompt?: string
): OllamaChatMessage[] {
  const trimmed = systemPrompt?.trim();
  return trimmed
    ? [{ role: 'system', content: trimmed }, ...messages]
    : [...messages];
}

/**
 * Ollama `/api/chat` にストリーミングモードでリクエストし、生のレスポンスを返す。
 *
 * レスポンスボディの読み取り・パースは呼び出し側の責務（NDJSON 中継のため）。
 *
 * @param messages - 会話履歴（system / user / assistant / tool を時系列で並べる）
 * @param model - 使用モデル名。未指定時はデフォルトモデルを使う
 * @param tools - エージェントに渡すツール定義。空・未指定ならツール無しで送信する
 * @param options - 思考の有無・中断の信号などのオプション。未指定ならモデルの既定に従い、中断しない
 * @returns ストリーミング応答の `Response`（呼び出し側でボディを逐次読み取る）
 * @throws {Error} Ollama API が非 2xx を返した場合
 * @throws {DOMException} `options.signal` が abort された場合（`AbortError`）。応答の読み取り中に abort された場合も、読み取り側で同じ例外になる
 */
export async function streamChat(
  messages: OllamaChatMessage[],
  model?: string,
  tools?: OllamaToolDefinition[],
  options: OllamaChatOptions = {}
): Promise<Response> {
  const body: Record<string, unknown> = {
    model: model || OLLAMA_DEFAULT_MODEL,
    messages,
    stream: true,
    ...modelOptions(options),
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  if (options.think !== undefined) {
    body.think = options.think;
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  return response;
}

/**
 * Ollama `/api/chat` に非ストリーミング（`stream: false`）でリクエストし、応答本文を返す。
 *
 * タイトル自動生成のように「1 往復で短い文字列を得たい」用途で使う。ストリーミングが
 * 必要な場合は {@link streamChat} を使う。
 *
 * @param messages - 会話履歴（system / user / assistant を時系列で並べる）
 * @param model - 使用モデル名。未指定時はデフォルトモデルを使う
 * @param options - 思考の有無・中断の信号などのオプション。未指定ならモデルの既定に従い、中断しない
 * @returns アシスタント応答の本文（思考過程は含まない）。応答が空・欠落している場合は空文字
 * @throws {Error} Ollama API が非 2xx を返した場合
 */
export async function chatOnce(
  messages: OllamaChatMessage[],
  model?: string,
  options: OllamaChatOptions = {}
): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || OLLAMA_DEFAULT_MODEL,
      messages,
      stream: false,
      ...(options.think !== undefined && { think: options.think }),
      ...modelOptions(options),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.message?.content ?? '';
}

/**
 * 埋め込みのモデルが Ollama に無い（取得していない）ときに {@link embed} が投げるエラー（#17）。
 *
 * 画面に `ollama pull` を案内するため、ほかの失敗（接続できない等）と分ける。
 */
export class EmbeddingModelNotFoundError extends Error {
  /**
   * @param model - 見つからなかったモデル名
   */
  constructor(readonly model: string) {
    super(`埋め込みのモデル（${model}）がありません`);
    this.name = 'EmbeddingModelNotFoundError';
  }
}

/**
 * 環境変数 `OLLAMA_EMBED_MODEL` で決まる、埋め込みのモデル名を返す（#17）。
 *
 * @returns 埋め込みのモデル名（未設定時は `embeddinggemma:300m`）
 */
export function getEmbeddingModel(): string {
  return OLLAMA_DEFAULT_EMBED_MODEL;
}

/**
 * Ollama `/api/embed` で文の並びの埋め込みを作る（#17）。
 *
 * モデルは {@link getEmbeddingModel}。Ollama は長さ 1 に正規化したベクトルを返す。
 * 返ってきた数・次元が送った文とそろっていなければ、壊れた応答として失敗にする（保存してから比べられないと分かるより早く止める）。
 *
 * @param texts - 埋め込みを作る文。空なら Ollama を呼ばずに空の配列を返す
 * @param options - `signal`（中断の信号）
 * @returns 文と同じ順の埋め込み
 * @throws {EmbeddingModelNotFoundError} モデルが Ollama に無い場合
 * @throws {Error} Ollama に接続できない・非 2xx（埋め込みに対応していないモデル等）・応答の形が違う場合
 */
export async function embed(
  texts: string[],
  options: { signal?: AbortSignal } = {}
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = OLLAMA_DEFAULT_EMBED_MODEL;
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
    signal: options.signal,
  });

  if (response.status === 404) {
    throw new EmbeddingModelNotFoundError(model);
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  const data: unknown = await response.json();
  const embeddings =
    typeof data === 'object' && data !== null && 'embeddings' in data
      ? data.embeddings
      : undefined;
  if (!isEmbeddingList(embeddings) || embeddings.length !== texts.length) {
    throw new Error('Ollama の埋め込みの応答の形が違います');
  }
  return embeddings;
}

/**
 * 値が、同じ次元の数の配列の並びかを判定する（{@link embed} の応答の検証）。
 *
 * @param value - Ollama の応答の `embeddings`
 * @returns すべての要素が 1 次元以上・同じ長さ・有限の数の配列なら true
 */
function isEmbeddingList(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first: unknown = value[0];
  if (!Array.isArray(first) || first.length === 0) return false;
  const dimension = first.length;
  return value.every(
    (vector: unknown) =>
      Array.isArray(vector) &&
      vector.length === dimension &&
      vector.every((x: unknown) => typeof x === 'number' && Number.isFinite(x))
  );
}
