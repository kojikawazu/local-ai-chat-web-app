const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_DEFAULT_MODEL =
  process.env.OLLAMA_MODEL || 'qwen3-coder-next:latest';

import type { OllamaToolDefinition, OllamaToolCall } from './tools/types';

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
  };
  /** ストリームの終端チャンクなら true */
  done: boolean;
}

/**
 * Ollama にインストール済みのモデル情報（`/api/tags` の 1 要素）。
 */
export interface OllamaModel {
  /** モデル名（例: `qwen3-coder-next:latest`）。切替やリクエスト指定に使う */
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

/**
 * 環境変数 `OLLAMA_MODEL` で決まるデフォルトモデル名を返す。
 *
 * @returns デフォルトモデル名（未設定時は `qwen3-coder-next:latest`）
 */
export function getDefaultModel(): string {
  return OLLAMA_DEFAULT_MODEL;
}

/**
 * Ollama `/api/chat` にストリーミングモードでリクエストし、生のレスポンスを返す。
 *
 * レスポンスボディの読み取り・パースは呼び出し側の責務（NDJSON 中継のため）。
 *
 * @param messages - 会話履歴（system / user / assistant / tool を時系列で並べる）
 * @param model - 使用モデル名。未指定時はデフォルトモデルを使う
 * @param tools - エージェントに渡すツール定義。空・未指定ならツール無しで送信する
 * @returns ストリーミング応答の `Response`（呼び出し側でボディを逐次読み取る）
 * @throws {Error} Ollama API が非 2xx を返した場合
 */
export async function streamChat(
  messages: OllamaChatMessage[],
  model?: string,
  tools?: OllamaToolDefinition[]
): Promise<Response> {
  const body: Record<string, unknown> = {
    model: model || OLLAMA_DEFAULT_MODEL,
    messages,
    stream: true,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  return response;
}
