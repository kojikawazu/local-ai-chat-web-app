/** PlantUML サーバーの接続先の既定値。docker-compose.yml の plantuml サービスの公開ポートと一致させる */
const DEFAULT_PLANTUML_URL = 'http://localhost:8889';

/** PlantUML サーバーの応答を待つ上限（ms）。300 行のシーケンス図でも 0.5 秒かからない（実測）ため十分な余裕を持たせた値 */
const PLANTUML_TIMEOUT_MS = 10_000;

/** 描けなかったときに PlantUML サーバーが理由を入れる応答ヘッダー */
const ERROR_HEADER = 'X-PlantUML-Diagram-Error';
/** 描けなかった行（0 始まり）を PlantUML サーバーが入れる応答ヘッダー */
const ERROR_LINE_HEADER = 'X-PlantUML-Diagram-Error-Line';

/** PlantUML サーバーに繋がらない・応答しないときのメッセージ */
const UNAVAILABLE_ERROR =
  'PlantUML サーバーに接続できませんでした。`docker compose up -d` で起動してください';
/** 理由のヘッダーが無いまま描けなかったときのメッセージ */
const UNKNOWN_DIAGRAM_ERROR = 'PlantUML が図を描けませんでした';

/** PlantUML の描画の結果。失敗時は Route Handler が返す HTTP ステータスとメッセージを持つ。 */
export type PlantUmlResult =
  | { ok: true; svg: string }
  | {
      ok: false;
      /** 400: ソースの誤り（構文・SANDBOX で止めた include 等）。502: サーバーに繋がらない・想定外の応答 */
      status: 400 | 502;
      /** クライアントへ返す日本語のメッセージ */
      error: string;
    };

/**
 * PlantUML サーバーの接続先を環境変数 `PLANTUML_URL` から解決する。
 *
 * 呼び出しのたびに読む（テストで差し替えられるようにし、モジュール読み込み時に固定しない）。
 *
 * @returns 接続先のベース URL（末尾の `/` は落とす）。未設定・空なら {@link DEFAULT_PLANTUML_URL}
 */
function getPlantUmlUrl(): string {
  return (process.env.PLANTUML_URL?.trim() || DEFAULT_PLANTUML_URL).replace(
    /\/+$/,
    ''
  );
}

/**
 * PlantUML サーバーのエラーの応答ヘッダーから、利用者に見せるメッセージを作る。
 *
 * 行番号のヘッダーは 0 始まりのため、1 始まりにして添える。数値でなければ行番号は付けない。
 *
 * @param error - `X-PlantUML-Diagram-Error` の値。無ければ `null`
 * @param line - `X-PlantUML-Diagram-Error-Line` の値。無ければ `null`
 * @returns 例: `Syntax Error? (Assumed diagram type: sequence)（2 行目）`
 */
export function formatPlantUmlError(
  error: string | null,
  line: string | null
): string {
  const message = error?.trim() || UNKNOWN_DIAGRAM_ERROR;
  const index = line?.trim() ? Number(line) : NaN;
  if (!Number.isInteger(index) || index < 0) return message;
  return `${message}（${index + 1} 行目）`;
}

/**
 * PlantUML のソースを PlantUML サーバー（`POST /svg`）で SVG にする（#171）。
 *
 * ソースは書かれたまま送る（`@startuml` が無ければサーバーが補う）。サーバーは描けないとき 400 と
 * 理由のヘッダーを返すため、それを 400 のメッセージに変える。繋がらない・時間切れ・想定外の応答は 502。
 *
 * @param source - PlantUML のソース（検証済み）
 * @param signal - 呼び出し元の中断（ブラウザの切断）。中断されたら例外をそのまま投げる
 * @returns 成功時は SVG の文字列、失敗時は返す HTTP ステータスとメッセージ
 * @throws {DOMException} `signal` が中断された場合（`AbortError`）
 */
export async function renderPlantUml(
  source: string,
  signal: AbortSignal
): Promise<PlantUmlResult> {
  let res: Response;
  try {
    res = await fetch(`${getPlantUmlUrl()}/svg`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: source,
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(PLANTUML_TIMEOUT_MS),
      ]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    console.error('Failed to connect to PlantUML server:', error);
    return { ok: false, status: 502, error: UNAVAILABLE_ERROR };
  }

  try {
    if (res.ok) {
      return { ok: true, svg: await res.text() };
    }
    // 描けないときも本文はエラーを描いた SVG だが、表示はソースに戻すため読まずに捨てる
    await res.body?.cancel();
    if (res.status === 400) {
      return {
        ok: false,
        status: 400,
        error: formatPlantUmlError(
          res.headers.get(ERROR_HEADER),
          res.headers.get(ERROR_LINE_HEADER)
        ),
      };
    }
    console.error(`PlantUML server responded with status ${res.status}`);
    return { ok: false, status: 502, error: UNAVAILABLE_ERROR };
  } catch (error) {
    // 本文の読み取り中の切断・時間切れ
    if (signal.aborted) throw error;
    console.error('Failed to read PlantUML response:', error);
    return { ok: false, status: 502, error: UNAVAILABLE_ERROR };
  }
}
