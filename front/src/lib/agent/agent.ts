import type { OllamaChatMessage, OllamaStreamChunk } from '@/lib/llm/ollama';
import { streamChat, withSystemPrompt } from '@/lib/llm/ollama';
import { parsePositiveIntEnv } from './agent-config';
import { getAllToolDefinitions, executeTool } from './tools/index';
import type { ToolCallInfo } from '@/types/agent/tool-call';
import type {
  AgentStreamEvent,
  OllamaToolCall,
  ToolExecution,
  ToolOutput,
} from './tools/types';

const DEFAULT_MAX_TOOL_ROUNDS = 10;
// 最大ラウンド数として受け付ける上限。1 質問あたり 3〜5 ラウンドの想定（docs/09）に十分な
// 余裕を持たせつつ、誤設定でループが実質無制限にならない値
const MAX_TOOL_ROUNDS_LIMIT = 50;
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
// ツールタイムアウトとして受け付ける上限（ミリ秒、5 分）。web_search のリトライ込みでも
// 既定の 30 秒で足りる想定のため、これを超える値は誤設定とみなす
const TOOL_TIMEOUT_MS_LIMIT = 300_000;

const MAX_TOOL_ROUNDS = parsePositiveIntEnv(
  'AGENT_MAX_TOOL_ROUNDS',
  process.env.AGENT_MAX_TOOL_ROUNDS,
  { fallback: DEFAULT_MAX_TOOL_ROUNDS, max: MAX_TOOL_ROUNDS_LIMIT }
);
const TOOL_TIMEOUT_MS = parsePositiveIntEnv(
  'AGENT_TOOL_TIMEOUT_MS',
  process.env.AGENT_TOOL_TIMEOUT_MS,
  { fallback: DEFAULT_TOOL_TIMEOUT_MS, max: TOOL_TIMEOUT_MS_LIMIT }
);

// 最大ラウンド到達後の最終回答の前に流す注記。本文の一部として表示・保存され、
// 回答が上限で打ち切られた調査に基づくことをユーザーに示す
const MAX_ROUNDS_NOTICE = `> ⚠️ ツール呼び出しの上限（${MAX_TOOL_ROUNDS} 回）に達したため、ここまでに得た情報で回答します。\n\n`;

// 最大ラウンド到達後の最終回答で、履歴の末尾に足す指示。会話の途中に置いた system は
// モデルのテンプレートによって無視・破損されるため、user の発言として渡す
const FINAL_ANSWER_INSTRUCTION =
  'ツール呼び出しの上限に達したため、新しいツールは呼び出せません。これまでのツール実行結果だけを使って、元の質問に回答してください。情報が足りない点は、その旨を明記してください。';

/**
 * 同じ応答の中で接続先ごと使えないとわかったツールを、再び呼ばれたときに実行せず返す結果（#157）。
 *
 * モデルは失敗を伝えても言い換えて呼び直し続けるため、文章での指示に頼らずループで止める。
 * 止められている接続先（検索エンジン等）へのアクセスを増やさない効果もある。
 *
 * @param name - 呼ばれたツール名
 * @param reason - 先に失敗したときの理由
 * @returns モデルへ返す文章と、画面に出す失敗の要約
 */
function skippedToolOutput(name: string, reason: string): ToolOutput {
  return {
    result: `エラー: ${name} は、この応答の中で先に使えないとわかったため実行しませんでした（${reason}）。この応答ではこのツールを呼ばず、ここまでの情報で回答してください。`,
    isError: true,
    summary: '実行しませんでした（先の呼び出しで使えないとわかったため）',
  };
}

// NDJSON イベントを ReadableStream に書き込むヘルパー
function encodeEvent(event: AgentStreamEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event) + '\n');
}

// ツール実行（タイムアウト付き、全体タイムアウトはリトライ含む合計に適用）
// タイムアウト時は race で応答を返すだけでなく signal を abort し、ツール内の
// fetch・本文読み取り・リトライ待機を止めてバックグラウンドに処理を残さない。
// signal を見ないツールがあっても応答が返るよう race は残す。
// ループ全体の中断（ブラウザの停止・切断）でもツールを止めるため、loopSignal と合成して渡す。
// ツール自身の失敗は戻り値の isError で届く。ここで isError にするのは例外（タイムアウト・未登録のツール）だけ
async function runTool(
  name: string,
  args: Record<string, unknown>,
  loopSignal: AbortSignal
): Promise<ToolExecution & { durationMs: number }> {
  const start = Date.now();
  const abortController = new AbortController();
  const toolSignal = AbortSignal.any([abortController.signal, loopSignal]);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = new Error(
        `ツール "${name}" がタイムアウトしました (${TOOL_TIMEOUT_MS}ms)`
      );
      abortController.abort(timeoutError);
      reject(timeoutError);
    }, TOOL_TIMEOUT_MS);
  });

  try {
    const output = await Promise.race([
      executeTool(name, args, toolSignal),
      timeoutPromise,
    ]);
    clearTimeout(timeoutId);
    return { ...output, durationMs: Date.now() - start };
  } catch (e) {
    clearTimeout(timeoutId);
    const msg = e instanceof Error ? e.message : String(e);
    return {
      result: msg,
      isError: true,
      summary: msg,
      durationMs: Date.now() - start,
    };
  }
}

// Ollama のストリーミングレスポンスを読み取り、tool_calls かテキストかを判定する。
// Ollama は tool_calls がある場合、done=true のチャンクに tool_calls を含めて返す。
// テキスト応答の場合は各チャンクを逐次ストリームに流してリアルタイム表示を維持する。
// 思考過程は 2 通りの返し方に対応する: 本文中の <think> タグ（qwen3 等）と、
// 本文とは別の message.thinking フィールド（qwen3.8 等。#116）。
async function readOllamaResponse(
  response: Response,
  onTextChunk: (text: string) => void,
  onThinking: (text: string) => void
): Promise<{ toolCalls: OllamaToolCall[] }> {
  if (!response.body) {
    throw new Error('Ollama からのレスポンスが空です');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = '';
  const toolCalls: OllamaToolCall[] = [];

  // <think>...</think> をストリーム全体にわたって検出するためのバッファ
  let contentBuffer = '';
  let inThinkBlock = false;

  // message.thinking の断片をためるバッファ。断片はトークン単位で届き、thinking イベントは
  // trim されるため、断片ごとに流すと単語間の空白が消える。<think> タグと同じくブロック単位にし、
  // 思考が終わった時点（本文・ツール呼び出しが来た時点、またはストリームの終わり）でまとめて流す
  let thinkingFieldBuffer = '';
  const flushThinkingField = () => {
    if (thinkingFieldBuffer) onThinking(thinkingFieldBuffer);
    thinkingFieldBuffer = '';
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    lineBuffer += decoder.decode(value, { stream: true });
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk: OllamaStreamChunk = JSON.parse(line);

        if (chunk.message?.thinking) {
          thinkingFieldBuffer += chunk.message.thinking;
        }

        // tool_calls を収集（通常は done=true のチャンクに含まれる）
        if (chunk.message?.tool_calls) {
          flushThinkingField();
          toolCalls.push(...chunk.message.tool_calls);
        }

        if (chunk.message?.content && !chunk.message.tool_calls) {
          flushThinkingField();
          contentBuffer += chunk.message.content;

          // <think>...</think> ブロックをストリーム全体で検出する
          // チャンクをまたいでタグが分割される場合を正しく処理する
          while (contentBuffer.length > 0) {
            if (inThinkBlock) {
              const closeIdx = contentBuffer.indexOf('</think>');
              if (closeIdx >= 0) {
                // 閉じタグが見つかった → thinking コンテンツを通知
                const thinkingContent = contentBuffer.slice(0, closeIdx);
                if (thinkingContent) onThinking(thinkingContent);
                contentBuffer = contentBuffer.slice(
                  closeIdx + '</think>'.length
                );
                inThinkBlock = false;
              } else {
                // まだ閉じタグが来ていない → バッファを保持
                break;
              }
            } else {
              const openIdx = contentBuffer.indexOf('<think>');
              if (openIdx >= 0) {
                // 開きタグより前のテキストを即時通知
                const before = contentBuffer.slice(0, openIdx);
                if (before) onTextChunk(before);
                contentBuffer = contentBuffer.slice(openIdx + '<think>'.length);
                inThinkBlock = true;
              } else {
                // <think> タグの途中（例: "<thi"）かもしれないので末尾を保持
                // </think> も考慮して長い方のタグ長 - 1 を保持する
                const possibleTagStart =
                  Math.max('<think>'.length, '</think>'.length) - 1;
                if (contentBuffer.length > possibleTagStart) {
                  const safeFlush = contentBuffer.slice(
                    0,
                    contentBuffer.length - possibleTagStart
                  );
                  if (safeFlush) onTextChunk(safeFlush);
                  contentBuffer = contentBuffer.slice(
                    contentBuffer.length - possibleTagStart
                  );
                }
                break;
              }
            }
          }
        }
      } catch {
        // JSONパース失敗は無視
      }
    }
  }

  // ストリーム終了時に残ったバッファをフラッシュ（本文なしで思考だけが返った場合を含む）
  flushThinkingField();
  if (contentBuffer) {
    // 閉じタグが来なかった場合（不正な出力）も thinking として扱う
    if (inThinkBlock) {
      onThinking(contentBuffer);
    } else {
      onTextChunk(contentBuffer);
    }
  }

  return { toolCalls };
}

// 1 回分の Ollama 応答を読み、本文を text_delta・思考過程を thinking イベントとして中継する。
// 中継した本文の有無は、最大ラウンド到達後の最終回答が空だったかの判定に使う
async function relayOllamaResponse(
  send: (event: AgentStreamEvent) => void,
  response: Response
): Promise<{ toolCalls: OllamaToolCall[]; hasText: boolean }> {
  let hasText = false;
  const { toolCalls } = await readOllamaResponse(
    response,
    (text) => {
      // テキストチャンクをリアルタイムに送信（バッファなし）
      if (text) {
        if (text.trim()) hasText = true;
        send({ type: 'text_delta', content: text });
      }
    },
    (thinking) => {
      if (thinking.trim()) {
        send({ type: 'thinking', content: thinking.trim() });
      }
    }
  );
  return { toolCalls, hasText };
}

/**
 * エージェントループを実行し、進捗を NDJSON イベントとして流す ReadableStream を返す。
 *
 * ツール呼び出しが無くなるまで最大 `MAX_TOOL_ROUNDS` 回、Ollama への問い合わせと
 * ツール実行を繰り返す。テキストは逐次 `text_delta` で中継し、思考過程（`<think>` ブロック、
 * または `message.thinking` フィールド）は `thinking` イベントとして分離する。
 * 最大ラウンドに達してもツール呼び出しが続く場合は、ツールを渡さずにもう 1 回問い合わせ、
 * 取得済みのツール結果で最終回答を作らせる（上限到達の注記を先頭に付ける）。
 * ツールが接続先ごと使えない失敗（`unavailable`）を返したら、同じ応答の中ではそのツールを
 * 再び実行せず、実行しなかったことを結果として返す（#157）。
 * エージェントモード（enableTools=true）時に呼ぶ。
 *
 * `signal` の abort、または返したストリームの cancel（ブラウザの停止・切断）でループを止める。
 * 実行中の Ollama への問い合わせとツールを中断し、以降のラウンドもツールも実行しない。
 *
 * @param messages - 会話履歴（user / assistant / tool を時系列で並べる）
 * @param model - 使用モデル名。未指定時はデフォルトモデルを使う
 * @param systemPrompt - 先頭に付与するシステムプロンプト。空・未指定なら付与しない
 * @param signal - 中断の信号（Route Handler の `request.signal`）。未指定ならストリームの cancel でのみ止まる
 * @returns NDJSON イベント（text_delta / thinking / tool_call_start / tool_call_result / done / error）を流すストリーム
 */
export function runAgentLoop(
  messages: OllamaChatMessage[],
  model?: string,
  systemPrompt?: string,
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const tools = getAllToolDefinitions();
  const toolCallRecords: ToolCallInfo[] = [];
  // ツール名 → 接続先ごと使えないとわかったときの理由。以降の呼び出しは実行しない
  const unavailableTools = new Map<string, string>();
  // ストリームの cancel 用。外からの signal とまとめて 1 つの中断の信号にする
  const cancelController = new AbortController();
  const loopSignal = signal
    ? AbortSignal.any([signal, cancelController.signal])
    : cancelController.signal;

  return new ReadableStream<Uint8Array>({
    cancel(reason) {
      cancelController.abort(reason);
    },
    async start(controller) {
      // 中断後は書き込まない。閉じたストリームへの enqueue は例外になり、それを
      // readOllamaResponse の JSON 解析の catch が握りつぶすと、接続が切れたあともループが回り続ける
      const send = (event: AgentStreamEvent) => {
        if (!loopSignal.aborted) controller.enqueue(encodeEvent(event));
      };
      const close = () => {
        if (!loopSignal.aborted) controller.close();
      };

      // システムプロンプトがあれば先頭に追加
      const history = withSystemPrompt(messages, systemPrompt);
      const loopStartTime = Date.now();

      // 完了イベント（ツール呼び出し記録・実行統計付き）を送ってストリームを閉じる。
      // agentRounds は Ollama への問い合わせ回数（最終回答の問い合わせを含む）
      const finish = (agentRounds: number) => {
        send({
          type: 'done',
          metadata: {
            toolCalls: toolCallRecords,
            agentRounds,
            agentDurationMs: Date.now() - loopStartTime,
          },
        });
        close();
      };

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          let ollamaResponse: Response;
          try {
            ollamaResponse = await streamChat(history, model, tools, {
              signal: loopSignal,
            });
          } catch (e) {
            // 停止・切断による中断は接続の失敗ではない。受け取る相手もいないため何も送らない
            if (loopSignal.aborted) return;
            const msg = e instanceof Error ? e.message : String(e);
            send({
              type: 'error',
              message: `Ollamaへの接続に失敗しました: ${msg}`,
            });
            close();
            return;
          }

          const { toolCalls } = await relayOllamaResponse(send, ollamaResponse);

          // ツール呼び出しなし → テキスト応答のストリーミングは中継時に完了済み
          if (toolCalls.length === 0) {
            finish(round + 1);
            return;
          }

          // ツール呼び出しあり → assistant メッセージを履歴に追加
          history.push({
            role: 'assistant',
            content: '',
            tool_calls: toolCalls,
          });

          // 複数ツールを Promise.allSettled で並列実行
          const toolResults = await Promise.allSettled(
            toolCalls.map(async (tc) => {
              const name = tc.function.name;
              const args = tc.function.arguments;

              // 実行開始イベント
              send({ type: 'tool_call_start', name, arguments: args });

              const skipReason = unavailableTools.get(name);
              // unavailable はループだけが読む印。画面・DB へは送らない
              const { durationMs, unavailable, ...output } =
                skipReason === undefined
                  ? await runTool(name, args, loopSignal)
                  : { ...skippedToolOutput(name, skipReason), durationMs: 0 };
              if (unavailable) {
                unavailableTools.set(name, output.summary ?? output.result);
              }

              // 実行結果イベント
              send({ type: 'tool_call_result', name, ...output });

              toolCallRecords.push({
                name,
                arguments: args,
                ...output,
                durationMs,
              });

              return { name, result: output.result };
            })
          );

          // ツール実行中に停止・切断された。次のラウンドへ進まない
          if (loopSignal.aborted) return;

          // tool ロールのメッセージを呼び出し順で履歴に追加
          for (let i = 0; i < toolCalls.length; i++) {
            const settled = toolResults[i];
            const result =
              settled.status === 'fulfilled'
                ? settled.value.result
                : settled.reason instanceof Error
                  ? settled.reason.message
                  : String(settled.reason);

            history.push({ role: 'tool', content: result });
          }
        }

        // 最大ラウンド数に到達してもツール呼び出しが続いた（#96）。
        // 取得済みの結果を捨てないよう、ツールを渡さずにもう 1 回問い合わせて最終回答を作らせる。
        // ツール定義が無ければモデルはツールを呼べず、テキストで答えるしかない
        send({ type: 'text_delta', content: MAX_ROUNDS_NOTICE });
        history.push({ role: 'user', content: FINAL_ANSWER_INSTRUCTION });
        try {
          const finalResponse = await streamChat(history, model, undefined, {
            signal: loopSignal,
          });
          const { hasText } = await relayOllamaResponse(send, finalResponse);
          if (!hasText) throw new Error('応答が空でした');
        } catch (e) {
          if (loopSignal.aborted) return;
          // 最終回答だけが失敗した場合も error にはしない。error を受けたクライアントは
          // 作成中のメッセージを破棄するため、取得済みのツール結果まで失われる。
          // 失敗を本文で伝え、ツール結果は done の metadata として表示・保存させる
          console.error('Final answer after max tool rounds failed:', e);
          const msg = e instanceof Error ? e.message : String(e);
          send({
            type: 'text_delta',
            content: `\n\n最終回答の生成に失敗しました: ${msg}`,
          });
        }
        finish(MAX_TOOL_ROUNDS + 1);
      } catch (e) {
        // Ollama の応答の読み取り中に停止・切断された（読み取りが AbortError になる）
        if (loopSignal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        send({ type: 'error', message: msg });
        close();
      } finally {
        // 停止・切断で抜けた場合もストリームを閉じ、読み手を待たせない（request.signal だけが
        // abort された場合、cancel されていないストリームが開いたまま残る）。
        // cancel 済みのストリームへの close は例外になるため無視する
        if (loopSignal.aborted) {
          try {
            controller.close();
          } catch {
            // cancel 済み
          }
        }
      }
    },
  });
}
