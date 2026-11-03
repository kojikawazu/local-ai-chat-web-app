import type { OllamaChatMessage, OllamaStreamChunk } from '@/lib/llm/ollama';
import { streamChat, supportsVision, withSystemPrompt } from '@/lib/llm/ollama';
import { parsePositiveIntEnv } from './agent-config';
import {
  getAllToolDefinitions,
  executeTool,
  getTool,
  hasVisionTools,
} from './tools/index';
import { waitForApproval } from './approvals';
import {
  hasInstructions,
  onInstruction,
  registerResponse,
  takeInstructions,
  unregisterResponse,
} from './instructions';
import { addMetrics, metricsFromDoneChunk } from '@/lib/llm/metrics';
import { APPROVAL_TIMEOUT_MS } from '@/constants/agent/approval';
import { DELEGATE_TOOL_NAME } from '@/constants/agent/sub-agent';
import type {
  ToolApproval,
  ToolCallInfo,
  ToolScreenshot,
} from '@/types/agent/tool-call';
import type { ResponseMetrics } from '@/types/chat/metrics';
import type { KnowledgeSource } from '@/types/knowledge/document';
import type {
  AgentStreamEvent,
  OllamaToolCall,
  Tool,
  ToolAccess,
  ToolContext,
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

// 利用者の途中の指示（#241）を履歴に入れるときの前置き。最初の質問と区別させ、方針を直す指示だと分からせる
const INSTRUCTION_PREFIX =
  '（応答の途中で利用者から届いた追加の指示。ここまでの作業を活かし、この指示に沿って方針を直して続けること）';

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

/**
 * ローカルのファイル・コマンドの出力・GitHub の内容・登録したドキュメント（#17 Phase B）を読んだ後のため、外部と通信するツールを実行しなかったことを表す結果（#148）。
 *
 * 読んだ内容を検索語・URL に埋めて外へ送らせないため。Web の結果などに仕込まれた指示で
 * ファイルを読まされた場合でも、そこから外へ出す手段を無くす。
 *
 * @param name - 実行しなかったツール名
 * @returns モデルへ返す文章と、画面に出す失敗の要約
 */
function blockedNetworkToolOutput(name: string): ToolOutput {
  return {
    result: `エラー: ${name} は実行しませんでした。この応答ではローカルのファイル・コマンドの出力・GitHub の内容・登録したドキュメントを読んだため、読んだ内容が外部へ送られないよう、外部と通信するツールを止めています。ここまでの情報で回答し、Web で調べる必要があれば、別の質問として改めて頼むよう利用者に伝えてください。`,
    isError: true,
    summary:
      '実行しませんでした（ローカルのファイル・コマンドの出力・GitHub の内容・登録したドキュメントを読んだ後のため）',
  };
}

/**
 * 画像を読めないモデルが、渡していない画像のツール（`requiresVision`。#149）を呼んだときの結果。
 *
 * ツールの一覧から外しても、モデルが名前を覚えていて呼ぶことがある。実行して画像を渡せないまま返すと、
 * モデルは見たふりをして答えるため、実行せずに理由を返す。
 *
 * @param name - 呼ばれたツール名
 * @returns モデルへ返す文章と、画面に出す失敗の要約
 */
export function visionRequiredOutput(name: string): ToolOutput {
  const reason = `選択中のモデルは画像を読めないため、${name} は使えません`;
  return {
    result: `エラー: ${reason}。ページの内容は browser_snapshot で文字として読んでください。`,
    isError: true,
    summary: reason,
  };
}

/**
 * モデルへ渡していないツールを呼ばれたときの結果（#26）。
 *
 * 設定で有効にしていない委譲のツール・サブエージェントだけのツールを、モデルが名前を覚えていて呼ぶことがある。
 * 渡したツールだけを実行する（渡していないものは、それぞれの条件を満たしていない）。
 *
 * @param name - 呼ばれたツール名
 * @returns モデルへ返す文章と、画面に出す失敗の要約
 */
export function notOfferedToolOutput(name: string): ToolOutput {
  const reason = `${name} はこの応答では使えません`;
  return {
    result: `エラー: ${reason}。渡したツールだけを使ってください。`,
    isError: true,
    summary: reason,
  };
}

/**
 * ツールが今回の呼び出しで何に触れるかを決める（#148・#149）。
 *
 * 固定の値ならそのまま、引数で変わるツール（開く URL で変わるブラウザ）は引数から決める。
 *
 * @param tool - 呼ばれたツール（未登録なら `undefined`）
 * @param args - LLM から渡された引数
 * @returns 触れるもの（{@link ToolAccess}）。どちらでもなければ `undefined`
 */
export function resolveAccess(
  tool: Tool | undefined,
  args: Record<string, unknown>
): ToolAccess | undefined {
  const access = tool?.access;
  return typeof access === 'function' ? access(args) : access;
}

/**
 * ツールを実行せずに止めるかを判定する（#148）。
 *
 * 同じ応答の中でローカルのファイルを読むツールが成功した後は、外部と通信するツールを止める。
 *
 * @param access - 実行しようとしているツールが触れるもの（{@link ToolAccess}）
 * @param hasReadLocalFiles - この応答でローカルのファイルを読むツールが成功したか
 * @returns 止めるなら true
 */
export function shouldBlockTool(
  access: ToolAccess | undefined,
  hasReadLocalFiles: boolean
): boolean {
  return hasReadLocalFiles && access === 'network';
}

/**
 * ツールを呼んだ後のラウンドで新しい本文を送る前に、前の本文との間に入れる区切りを決める（#186）。
 *
 * 区切らずにつなぐと、ツールの前の一言（「確認します。」）と次の文がくっつく。本文を空行で区切り、
 * Markdown の段落として分ける。すでに空行・改行で終わっていれば、足りない分だけを足す。
 *
 * @param sentLength - それまでに送った本文の文字数
 * @param sentTail - それまでに送った本文の末尾（2 文字あれば足りる）
 * @returns 先に送る区切り（`\n\n`・`\n`）。本文がまだ無い・空行で終わっていれば空文字
 */
export function roundSeparator(sentLength: number, sentTail: string): string {
  if (sentLength === 0 || sentTail.endsWith('\n\n')) return '';
  return sentTail.endsWith('\n') ? '\n' : '\n\n';
}

// NDJSON イベントを ReadableStream に書き込むヘルパー
function encodeEvent(event: AgentStreamEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event) + '\n');
}

/** {@link withToolTimeout} の結果。 */
type TimedResult<T> =
  | { ok: true; value: T; durationMs: number }
  | { ok: false; message: string; durationMs: number };

// ツールの処理をタイムアウト付きで実行する（全体タイムアウトはリトライ含む合計に適用）。
// タイムアウト時は race で応答を返すだけでなく signal を abort し、ツール内の
// fetch・本文読み取り・リトライ待機を止めてバックグラウンドに処理を残さない。
// signal を見ないツールがあっても応答が返るよう race は残す。
// ループ全体の中断（ブラウザの停止・切断）でもツールを止めるため、loopSignal と合成して渡す。
// 承認が要るツールは、準備（prepare）と実行（run）にそれぞれ掛ける（承認を待つ時間には掛けない。#148 Phase A2）。
// 実行には、ツールが持つ上限（runTimeoutMs）があればそれを使う（コマンドの実行。#148 Phase B）
async function withToolTimeout<T>(
  name: string,
  task: (signal: AbortSignal) => Promise<T>,
  loopSignal: AbortSignal,
  timeoutMs: number = TOOL_TIMEOUT_MS
): Promise<TimedResult<T>> {
  const start = Date.now();
  const abortController = new AbortController();
  const toolSignal = AbortSignal.any([abortController.signal, loopSignal]);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = new Error(
        `ツール "${name}" がタイムアウトしました (${timeoutMs}ms)`
      );
      abortController.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    const value = await Promise.race([task(toolSignal), timeoutPromise]);
    clearTimeout(timeoutId);
    return { ok: true, value, durationMs: Date.now() - start };
  } catch (e) {
    clearTimeout(timeoutId);
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * タイムアウト・例外で終わった処理を、失敗の実行結果にする。
 *
 * @param message - 失敗の理由
 * @returns `isError: true` の実行結果
 */
function failedOutput(message: string): ToolExecution {
  return { result: message, isError: true, summary: message };
}

// ツール実行（タイムアウト付き）。ツール自身の失敗は戻り値の isError で届く。
// ここで isError にするのは例外（タイムアウト・未登録のツール）だけ
async function runTool(
  name: string,
  args: Record<string, unknown>,
  loopSignal: AbortSignal,
  context: ToolContext
): Promise<ToolExecution & { durationMs: number }> {
  const timed = await withToolTimeout(
    name,
    (signal) => executeTool(name, args, signal, context),
    loopSignal,
    // ツールが持つ上限（委譲のツール。#26）。無ければ withToolTimeout の既定（ツール全般の上限）
    getTool(name)?.timeoutMs
  );
  return timed.ok
    ? { ...timed.value, durationMs: timed.durationMs }
    : { ...failedOutput(timed.message), durationMs: timed.durationMs };
}

/**
 * スクリーンショットがあるときだけ、結果に足す `screenshots` を作る（#200。空の配列を記録に残さない）。
 *
 * @param screenshots - 撮った画面
 * @returns 1 枚以上あれば `{ screenshots }`、無ければ空のオブジェクト
 */
function withScreenshots(
  screenshots: ToolScreenshot[]
): Pick<ToolExecution, 'screenshots'> {
  return screenshots.length > 0 ? { screenshots } : {};
}

/**
 * 記録（`done`・DB）に入れるため、スクリーンショットから中身を外す（#200）。中身はイベントだけが運び、画面が添付画像として保存する。
 *
 * @param screenshots - 中身付きのスクリーンショット
 * @returns 中身を外したスクリーンショット。無ければ `undefined`
 */
export function stripScreenshotData(
  screenshots: ToolScreenshot[] | undefined
): ToolScreenshot[] | undefined {
  // data は分割代入で外す（記録には中身を入れない）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return screenshots?.map(({ data, ...shot }) => shot);
}

/**
 * 承認されずに書き込み等を行わなかったことを表す結果（#148 Phase A2）。
 *
 * @param decision - 承認の結果（拒否か時間切れ）
 * @returns モデルへ返す文章と、画面に出す失敗の要約
 */
export function declinedOutput(
  decision: Exclude<ToolApproval, 'approved'>
): ToolOutput {
  return decision === 'expired'
    ? {
        result:
          'エラー: 承認が得られなかった（時間切れ）ため実行しませんでした。必要なら、改めて実行してよいか利用者に確かめてください。',
        isError: true,
        summary: '承認されませんでした（時間切れ）',
      }
    : {
        result:
          'エラー: 利用者が拒否したため実行しませんでした。理由を聞くか、別の方法を提案してください。',
        isError: true,
        summary: '拒否されました',
      };
}

/** {@link createInOrderQueue} が返す順番待ち。 */
export type InOrderQueue = (<T>(
  key: string | undefined,
  task: () => Promise<T>
) => Promise<T>) & {
  /**
   * その組に、まだ終わっていない処理があるか（次に入れる処理が順番を待つか。#26 Phase B）
   *
   * @param key - 組の名前（無ければ並べて実行するため、常に false）
   * @returns 終わっていない処理があれば true
   */
  isBusy: (key: string | undefined) => boolean;
};

/**
 * 同じ組のツールを、呼ばれた順に 1 つずつ実行する順番待ちを作る（#149 Phase C。`Tool` の `exclusive`）。
 *
 * 組ごとに、最後に入れた処理の終わりをつなぐ。前の処理が失敗しても、続きの処理は進める。
 * 組の名前が無ければ待たずにすぐ実行する（並べて実行する）。組ごとに終わっていない処理を数え、順番を待つかを答える（#26 Phase B）。
 *
 * @returns 処理を入れる関数（組の名前と処理を受け取り、処理の結果を返す）。`isBusy` で組に終わっていない処理があるかを返す
 */
export function createInOrderQueue(): InOrderQueue {
  const tails = new Map<string, Promise<unknown>>();
  const pending = new Map<string, number>();
  const enqueue = <T>(
    key: string | undefined,
    task: () => Promise<T>
  ): Promise<T> => {
    if (key === undefined) return task();
    pending.set(key, (pending.get(key) ?? 0) + 1);
    const next = (tails.get(key) ?? Promise.resolve())
      .then(task)
      .finally(() => pending.set(key, (pending.get(key) ?? 1) - 1));
    tails.set(
      key,
      next.catch(() => {})
    );
    return next;
  };
  return Object.assign(enqueue, {
    isBusy: (key: string | undefined) =>
      key !== undefined && (pending.get(key) ?? 0) > 0,
  });
}

/**
 * 承認が要るツールを、準備 → 承認 → 実行の順に進める（#148 Phase A2。`docs/15-tool-approval.md`）。
 *
 * 準備で失敗したら承認は求めず、その結果を返す。準備できたら `tool_approval_request` を送り、
 * 承認の API から結果が届くまで待つ（停止・切断で取り消し、{@link APPROVAL_TIMEOUT_MS} で時間切れ。画面が残り時間を出せるよう、同じ値をイベントに載せる。#202）。許可されたら準備で作った処理を実行する。
 * 所要時間は準備と実行の合計（承認を待つ時間は含めない）。
 *
 * @param tool - 承認が要るツール（`prepare` を持つ）
 * @param args - LLM から渡された引数
 * @param callId - 呼び出しの ID（承認の依頼に載せ、画面が承認カードと記録を当てる。#26 Phase B）
 * @param send - イベントを送る関数
 * @param loopSignal - ループ全体の中断の signal
 * @param context - 応答ごとの文脈（準備に渡す。ブラウザの操作が開いたページを使う。#149 Phase C）
 * @returns 実行結果・所要時間・承認の結果（準備で失敗したら承認の結果は無し）
 */
async function runWithApproval(
  tool: Tool & { prepare: NonNullable<Tool['prepare']> },
  args: Record<string, unknown>,
  callId: string,
  send: (event: AgentStreamEvent) => void,
  loopSignal: AbortSignal,
  context: ToolContext
): Promise<ToolExecution & { durationMs: number; approval?: ToolApproval }> {
  const name = tool.definition.name;
  const prepared = await withToolTimeout(
    name,
    (signal) => tool.prepare(args, signal, context),
    loopSignal
  );
  if (!prepared.ok) {
    return {
      ...failedOutput(prepared.message),
      durationMs: prepared.durationMs,
    };
  }
  if (!prepared.value.ok) {
    return { ...prepared.value.output, durationMs: prepared.durationMs };
  }

  // 準備で撮った画面（操作の前。#200）は、承認の結果にかかわらず結果に入れる
  const prepShots = prepared.value.screenshots ?? [];
  const approvalId = crypto.randomUUID();
  send({
    type: 'tool_approval_request',
    approvalId,
    callId,
    name,
    preview: prepared.value.preview,
    timeoutMs: APPROVAL_TIMEOUT_MS,
  });
  const decision = await waitForApproval({
    id: approvalId,
    signal: loopSignal,
    timeoutMs: APPROVAL_TIMEOUT_MS,
  });
  if (decision !== 'approved') {
    return {
      ...declinedOutput(decision),
      ...withScreenshots(prepShots),
      durationMs: prepared.durationMs,
      approval: decision,
    };
  }

  const { run } = prepared.value;
  const ran = await withToolTimeout(name, run, loopSignal, tool.runTimeoutMs);
  const durationMs = prepared.durationMs + ran.durationMs;
  return ran.ok
    ? {
        ...ran.value,
        ...withScreenshots([...prepShots, ...(ran.value.screenshots ?? [])]),
        durationMs,
        approval: 'approved',
      }
    : {
        ...failedOutput(ran.message),
        ...withScreenshots(prepShots),
        durationMs,
        approval: 'approved',
      };
}

/**
 * 承認の要求を送る相手がいないループ（サブエージェント。#26）で、承認が要るツールを呼ばれたときの結果。
 *
 * サブエージェントには読むツールだけを渡すため、ふつうは通らない。通っても承認を経ずに実行しない。
 *
 * @param name - 呼ばれたツール名
 * @returns モデルへ返す文章と、画面に出す失敗の要約
 */
function approvalUnavailableOutput(name: string): ToolOutput {
  const reason = `${name} は利用者の承認が要るため、ここでは実行できません`;
  return { result: `エラー: ${reason}`, isError: true, summary: reason };
}

/** {@link executeToolCall} に渡す、ループ（メイン・サブエージェント）の状態。 */
export type ToolCallState = {
  /** この応答でモデルへ渡したツールの名前。渡していないツールは実行しない（#26） */
  offered: ReadonlySet<string>;
  /** モデルが画像を読めるか（#149） */
  vision: boolean;
  /** 接続先ごと使えないとわかったツール名 → 理由（#157）。以降の呼び出しは実行しない。実行した結果で足す */
  unavailableTools: Map<string, string>;
  /**
   * この応答で手元の情報を読むツールが成功したか（#148）
   *
   * @returns 読んでいれば true
   */
  hasReadLocal: () => boolean;
  /** 手元の情報を読んだことを記録する（以降は外部と通信するツールを止める） */
  markReadLocal: () => void;
  /** ループ全体の中断の signal */
  signal: AbortSignal;
  /** 応答ごとの文脈（{@link ToolContext}） */
  context: ToolContext;
  /**
   * イベントを送る（承認の要求）。無いループ（サブエージェント）では、承認が要るツールを実行しない
   *
   * @param event - 送るイベント
   */
  send?: (event: AgentStreamEvent) => void;
};

/** {@link executeToolCall} の結果。ループだけが読む印は外し、画面・DB へ送るものとループが使うものに分けてある。 */
export type ToolCallOutcome = {
  /** 画面・DB へ送る結果（承認の結果・サブエージェントの記録を含む） */
  output: ToolOutput & Pick<ToolCallInfo, 'approval'>;
  /** 所要時間（承認を待つ時間は含めない） */
  durationMs: number;
  /** モデルへ画像として渡すもの（#149） */
  images?: string[];
  /** 利用者へ見せる画面（中身付き。#200） */
  screenshots?: ToolScreenshot[];
  /** ツールの中で使ったトークン数・所要時間（サブエージェント。#26） */
  metrics?: ResponseMetrics;
};

/**
 * 1 回のツールの呼び出しを、止める規則を当ててから実行する（メインとサブエージェントで共通。#26 で runAgentLoop から切り出した）。
 *
 * 判定の順: 同じ応答で使えないとわかった → 画像を読めないモデルの画像のツール → モデルへ渡していない →
 * 手元を読んだ後の外部と通信するツール（#148）→ 承認が要るツール（承認の後に実行）→ 実行。
 * 実行の後、接続先ごと使えない失敗（`unavailable`）と、手元の情報を読んだこと（`access: 'local'` の成功・`readLocal`）を `state` に記録する。
 *
 * イベントを送れるループ（メイン）では、ツールへ渡す文脈に、途中の経過を `callId` 付きで送る `emit` を足す（#26 Phase B）。
 *
 * @param name - 呼ばれたツール名
 * @param args - LLM から渡された引数
 * @param state - ループの状態（{@link ToolCallState}）
 * @param callId - 呼び出しの ID（承認の依頼・途中の経過に載せる。#26 Phase B）
 * @returns 結果（{@link ToolCallOutcome}）。失敗も例外にせず `isError` で返す
 */
export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  state: ToolCallState,
  callId: string
): Promise<ToolCallOutcome> {
  const tool = getTool(name);
  const { send } = state;
  const context: ToolContext = send
    ? { ...state.context, emit: (event) => send({ ...event, callId }) }
    : state.context;
  const skipReason = state.unavailableTools.get(name);
  const access = resolveAccess(tool, args);
  const {
    durationMs,
    unavailable,
    images,
    readLocal,
    screenshots,
    metrics,
    ...output
  } =
    skipReason !== undefined
      ? { ...skippedToolOutput(name, skipReason), durationMs: 0 }
      : tool?.requiresVision && !state.vision
        ? { ...visionRequiredOutput(name), durationMs: 0 }
        : tool && !state.offered.has(name)
          ? { ...notOfferedToolOutput(name), durationMs: 0 }
          : shouldBlockTool(access, state.hasReadLocal())
            ? { ...blockedNetworkToolOutput(name), durationMs: 0 }
            : tool?.prepare
              ? send
                ? await runWithApproval(
                    { ...tool, prepare: tool.prepare },
                    args,
                    callId,
                    send,
                    state.signal,
                    context
                  )
                : { ...approvalUnavailableOutput(name), durationMs: 0 }
              : await runTool(name, args, state.signal, context);
  if (unavailable) {
    state.unavailableTools.set(name, output.summary ?? output.result);
  }
  if ((access === 'local' && !output.isError) || readLocal) {
    state.markReadLocal();
  }
  return { output, durationMs, images, screenshots, metrics };
}

/**
 * Ollama のストリーミングレスポンスを読み取り、tool_calls かテキストかを判定する。
 *
 * Ollama は tool_calls がある場合、done=true のチャンクに tool_calls を含めて返す。
 * テキスト応答の場合は各チャンクを逐次 `onTextChunk` に渡す（メインはストリームに流してリアルタイム表示を維持し、
 * サブエージェント（#26）は集める）。
 * 思考過程は 2 通りの返し方に対応する: 本文中の <think> タグ（qwen3 等）と、
 * 本文とは別の message.thinking フィールド（qwen3.8 等。#116）。
 *
 * @param response - Ollama の `/api/chat` のストリーミングの応答
 * @param onTextChunk - 本文の断片を受け取る
 * @param onThinking - 思考過程のまとまりを受け取る
 * @returns 呼ばれたツールと、終わりのチャンクのトークン数・所要時間（#31。届かなければ `undefined`）
 * @throws {Error} 応答のボディが無い場合、または読み取り中に中断された場合
 */
export async function readOllamaResponse(
  response: Response,
  onTextChunk: (text: string) => void,
  onThinking: (text: string) => void
): Promise<{ toolCalls: OllamaToolCall[]; metrics?: ResponseMetrics }> {
  if (!response.body) {
    throw new Error('Ollama からのレスポンスが空です');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = '';
  const toolCalls: OllamaToolCall[] = [];
  let metrics: ResponseMetrics | undefined;

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
        if (chunk.done) metrics = metricsFromDoneChunk(chunk);

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

  return { toolCalls, metrics };
}

// 1 回分の Ollama 応答を読み、本文を text_delta・思考過程を thinking イベントとして中継する。
// 中継した本文の有無は、最大ラウンド到達後の最終回答が空だったかの判定に使う。
// トークン数・所要時間（#31）は呼び出し側がラウンドを合計する
async function relayOllamaResponse(
  send: (event: AgentStreamEvent) => void,
  response: Response
): Promise<{
  toolCalls: OllamaToolCall[];
  hasText: boolean;
  metrics?: ResponseMetrics;
}> {
  let hasText = false;
  const { toolCalls, metrics } = await readOllamaResponse(
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
  return { toolCalls, hasText, metrics };
}

/** {@link runAgentLoop} の応答ごとの指定。 */
type AgentLoopOptions = {
  /**
   * 送る前に登録したドキュメントを探した結果の出典（#17 Phase B）。探さなかった応答は `undefined`、
   * 探したが見つからなかった応答は空の配列
   */
  knowledgeSources?: KnowledgeSource[];
  /**
   * 委譲のツール（`delegate_to_agent`。#26）をモデルへ渡すか。設定の「サブエージェントに任せる」。
   * 偽・省略なら渡さない（呼ばれても実行しない）
   */
  enableSubAgents?: boolean;
};

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
 * ローカルのファイルを読むツールが成功した後は、外部と通信するツールを実行しない（#148。{@link shouldBlockTool}）。
 * モデルへ渡していないツール（設定で有効にしていない委譲のツール・サブエージェントだけのツール。#26）は実行しない。
 * 1 回のツールの呼び出しの判定と実行は {@link executeToolCall} で行う（サブエージェントのループと共有）。
 * 承認が要るツール（`prepare` を持つ。ファイルの書き込み等）は、`tool_approval_request` を送って利用者の許可を待ってから実行する
 * （#148 Phase A2。{@link runWithApproval}）。
 * ツールには応答ごとの文脈（{@link ToolContext}。#149）を渡し、応答の終わりに、ツールが登録した後始末（ブラウザのページを閉じる等）を行う。
 * 結果を画像で渡すツール（`requiresVision`）は、モデルが画像を読めるときだけ渡し、結果の画像を `role: 'tool'` のメッセージに付ける。
 * エージェントモード（enableTools=true）時に呼ぶ。
 *
 * `signal` の abort、または返したストリームの cancel（ブラウザの停止・切断）でループを止める。
 * 実行中の Ollama への問い合わせとツールを中断し、以降のラウンドもツールも実行しない。
 *
 * @param messages - 会話履歴（user / assistant / tool を時系列で並べる）
 * @param model - 使用モデル名。未指定時はデフォルトモデルを使う
 * @param systemPrompt - 先頭に付与するシステムプロンプト。空・未指定なら付与しない
 * @param signal - 中断の信号（Route Handler の `request.signal`）。未指定ならストリームの cancel でのみ止まる
 * @param appOrigin - このアプリ自身のオリジン（ブラウザのツールで開かせない。#149）。未指定なら判定しない
 * @param options - 応答ごとの指定。`knowledgeSources`（#17 Phase B）があれば、ストリームの最初に `knowledge_sources` を送る。
 *   1 件以上なら、抜き出しをシステムプロンプトで渡した応答として、最初から手元の情報を読んだ扱いにする（外部と通信するツールを止める）。
 *   `enableSubAgents`（#26）が真なら、委譲のツールをモデルへ渡す（サブエージェントのトークン数も応答の合計に足す）
 * @returns NDJSON イベント（knowledge_sources / text_delta / thinking / tool_call_start / tool_call_result / done / error）を流すストリーム
 */
export function runAgentLoop(
  messages: OllamaChatMessage[],
  model?: string,
  systemPrompt?: string,
  signal?: AbortSignal,
  appOrigin?: string,
  options: AgentLoopOptions = {}
): ReadableStream<Uint8Array> {
  const { knowledgeSources, enableSubAgents = false } = options;
  const toolCallRecords: ToolCallInfo[] = [];
  // ツール名 → 接続先ごと使えないとわかったときの理由。以降の呼び出しは実行しない
  const unavailableTools = new Map<string, string>();
  // この応答で手元の情報を読むツール（access: local。ファイル・コマンド・GitHub）が成功したか。以降は外部と通信するツールを止める。
  // 登録したドキュメントの抜き出しを渡した応答（#17 Phase B）は、最初から読んだ扱いにする
  let hasReadLocalFiles = (knowledgeSources?.length ?? 0) > 0;
  // 応答の終わりに行う後始末（ブラウザのページを閉じる等。#149）
  const disposers: (() => Promise<void>)[] = [];
  // 応答の途中の指示（#241）の受け箱。届いたら今の signal を abort し（サブエージェントがまとめ始める）、読んだら新しい signal に替える
  const responseId = crypto.randomUUID();
  registerResponse(responseId);
  let instructionController = new AbortController();
  const stopListening = onInstruction(responseId, () =>
    instructionController.abort()
  );
  const toolContext: ToolContext = {
    appOrigin,
    model,
    scope: new Map(),
    onDispose: (dispose) => {
      disposers.push(dispose);
    },
    hasReadLocal: () => hasReadLocalFiles,
    instructionSignal: () => instructionController.signal,
  };
  // 同じ組（exclusive）のツールを、呼ばれた順に 1 つずつ実行する（#149 Phase C）
  const inOrder = createInOrderQueue();
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

      // 送った本文の文字数と末尾。ツールを呼んだ位置（contentOffset）と、ラウンドの区切りに使う（#186）。
      // 画面は text_delta をそのままつなぐため、ここで数えた文字数と画面の本文の位置は一致する
      let sentLength = 0;
      let sentTail = '';
      // ツールを呼んだ後で、次に届く本文の前に区切りを入れるか
      let pendingSeparator = false;
      // このラウンドで送った本文（本文を書き終えた後に指示が届いたとき、書いた本文を履歴に足す。#241）
      let roundText = '';
      const emitText = (text: string) => {
        send({ type: 'text_delta', content: text });
        sentLength += text.length;
        sentTail = (sentTail + text).slice(-2);
        roundText += text;
      };
      // 本文の中継・上限の注記は、区切りと文字数の勘定を通して送る
      const sendEvent = (event: AgentStreamEvent) => {
        if (event.type !== 'text_delta') {
          send(event);
          return;
        }
        if (pendingSeparator) {
          pendingSeparator = false;
          const separator = roundSeparator(sentLength, sentTail);
          if (separator) emitText(separator);
        }
        emitText(event.content);
      };

      // 利用者の途中の指示（#241）を区切りで読む。user の発言として履歴に足し、読んだ位置を画面へ知らせる。
      // 読んだら signal を替える（次に任せる仕事を、もう読んだ指示でまとめさせない）
      const applyInstructions = () => {
        const items = takeInstructions(responseId);
        if (items.length === 0) return;
        instructionController = new AbortController();
        for (const item of items) {
          history.push({
            role: 'user',
            content: `${INSTRUCTION_PREFIX}\n${item.content}`,
          });
          send({
            type: 'instruction_applied',
            instructionId: item.id,
            contentOffset: sentLength,
          });
        }
        if (sentLength > 0) pendingSeparator = true;
      };

      // 探したドキュメントの出典は、本文より先に 1 回だけ送る（#17 Phase B）
      if (knowledgeSources) {
        send({ type: 'knowledge_sources', sources: knowledgeSources });
      }
      // 途中の指示（#241）を送る先の応答の ID
      send({ type: 'response_started', responseId });

      // システムプロンプトがあれば先頭に追加
      const history = withSystemPrompt(messages, systemPrompt);
      const loopStartTime = Date.now();
      // ラウンド（Ollama への問い合わせ）ごとのトークン数・所要時間の合計（#31）
      let metrics: ResponseMetrics | undefined;

      // 完了イベント（ツール呼び出し記録・実行統計付き）を送ってストリームを閉じる。
      // agentRounds は Ollama への問い合わせ回数（最終回答の問い合わせを含む）
      const finish = (agentRounds: number) => {
        send({
          type: 'done',
          metadata: {
            toolCalls: toolCallRecords,
            agentRounds,
            agentDurationMs: Date.now() - loopStartTime,
            ...(metrics && { metrics }),
          },
        });
        close();
      };

      // 画像を読めるモデルか。画像のツールが無ければ問い合わせない。問い合わせに失敗したら読めないものとする
      // （画像のツールを渡さないだけで、応答は続けられる）
      const vision = hasVisionTools()
        ? await supportsVision(model).catch(() => false)
        : false;
      const tools = getAllToolDefinitions({
        excludeVision: !vision,
        // 設定で有効にしていなければ、委譲のツールを渡さない（#26）
        excludeNames: enableSubAgents ? [] : [DELEGATE_TOOL_NAME],
      });
      const toolState: ToolCallState = {
        offered: new Set(tools.map((tool) => tool.function.name)),
        vision,
        unavailableTools,
        hasReadLocal: () => hasReadLocalFiles,
        markReadLocal: () => {
          hasReadLocalFiles = true;
        },
        signal: loopSignal,
        context: toolContext,
        send,
      };

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          roundText = '';
          applyInstructions();
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

          const relayed = await relayOllamaResponse(sendEvent, ollamaResponse);
          const { toolCalls } = relayed;
          metrics = addMetrics(metrics, relayed.metrics);

          // ツール呼び出しなし → テキスト応答のストリーミングは中継時に完了済み
          if (toolCalls.length === 0) {
            // 本文を書き終えた後に指示が届いていれば、書いた本文を残して続ける（次のラウンドの前に指示を読む。#241）
            if (hasInstructions(responseId) && round + 1 < MAX_TOOL_ROUNDS) {
              history.push({ role: 'assistant', content: roundText });
              pendingSeparator = true;
              continue;
            }
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

              // 実行開始イベント。同じラウンドのツールは同じ位置（その時点の本文の文字数）に並ぶ。
              // 呼び出しごとの ID で、画面が結果・承認・途中の経過を当てる（#26 Phase B）
              const contentOffset = sentLength;
              const callId = crypto.randomUUID();
              const tool = getTool(name);
              // 同じ組（exclusive）の前の呼び出しが終わっていなければ順番を待つ。画面に「順番待ち」と出させる（#26 Phase B）
              const queued = inOrder.isBusy(tool?.exclusive);
              send({
                type: 'tool_call_start',
                callId,
                name,
                arguments: args,
                contentOffset,
                ...(queued && { queued }),
              });

              // 同じ組（exclusive）のツールは、前の呼び出しの結果を送り終えてから始める（#149 Phase C）。
              // 止めるかの判定（使えない・手元を読んだ後）も、前の呼び出しの結果を見てから行う
              return inOrder(tool?.exclusive, async () => {
                // 順番を待つ間に停止・切断された。結果はもう送らないため、実行せずに終える
                if (loopSignal.aborted) {
                  return { name, result: '', images: undefined };
                }
                if (queued) send({ type: 'tool_call_begin', callId });
                const {
                  output,
                  durationMs,
                  images,
                  screenshots,
                  metrics: toolMetrics,
                } = await executeToolCall(name, args, toolState, callId);
                // サブエージェントのトークン数・所要時間も、応答のために使ったため合計に足す（#26）
                metrics = addMetrics(metrics, toolMetrics);

                // 実行結果イベント
                send({
                  type: 'tool_call_result',
                  callId,
                  name,
                  ...output,
                  ...(screenshots && { screenshots }),
                });

                toolCallRecords.push({
                  name,
                  arguments: args,
                  ...output,
                  ...(screenshots && {
                    screenshots: stripScreenshotData(screenshots),
                  }),
                  durationMs,
                  contentOffset,
                });

                return { name, result: output.result, images };
              });
            })
          );

          // ツール実行中に停止・切断された。次のラウンドへ進まない
          if (loopSignal.aborted) return;
          pendingSeparator = true;

          // tool ロールのメッセージを呼び出し順で履歴に追加
          for (let i = 0; i < toolCalls.length; i++) {
            const settled = toolResults[i];
            if (settled.status === 'fulfilled') {
              const { result, images } = settled.value;
              history.push({
                role: 'tool',
                content: result,
                ...(images && images.length > 0 && { images }),
              });
            } else {
              history.push({
                role: 'tool',
                content:
                  settled.reason instanceof Error
                    ? settled.reason.message
                    : String(settled.reason),
              });
            }
          }
        }

        // 最大ラウンド数に到達してもツール呼び出しが続いた（#96）。
        // 取得済みの結果を捨てないよう、ツールを渡さずにもう 1 回問い合わせて最終回答を作らせる。
        // ツール定義が無ければモデルはツールを呼べず、テキストで答えるしかない
        sendEvent({ type: 'text_delta', content: MAX_ROUNDS_NOTICE });
        applyInstructions();
        history.push({ role: 'user', content: FINAL_ANSWER_INSTRUCTION });
        try {
          const finalResponse = await streamChat(history, model, undefined, {
            signal: loopSignal,
          });
          const relayed = await relayOllamaResponse(sendEvent, finalResponse);
          metrics = addMetrics(metrics, relayed.metrics);
          if (!relayed.hasText) throw new Error('応答が空でした');
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
        // 途中の指示の受け箱を消す（終わった応答への指示の API は 404 になる。#241）
        stopListening();
        unregisterResponse(responseId);
        // ツールが登録した後始末（ブラウザのページを閉じる等）。失敗してもほかの後始末は続ける
        const disposed = await Promise.allSettled(
          disposers.map((dispose) => dispose())
        );
        for (const result of disposed) {
          if (result.status === 'rejected') {
            console.error('Tool dispose failed:', result.reason);
          }
        }
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
