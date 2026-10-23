/**
 * システムプロンプトに付ける「現在の日時」の組み立て（#154）。
 *
 * モデルは学習した時点を「今」と思い込むため、日付を知らせないと「最新」を古い年で検索したり、
 * 学習時点の版を最新として答えたりする。`get_current_datetime` ツールはあるが、呼ぶかはモデル任せで、
 * 実際には最初の検索の後に呼ばれていた。そこで `/api/chat` が毎回、日時をシステムプロンプトに入れる。
 */

/** 日時の文の見出し。既存のシステムプロンプトの後ろに、この見出しの節として足す */
const HEADING = '## 現在の日時';

/** タイムゾーンが不正なときに使うタイムゾーン（`get_current_datetime` の不正時と同じ扱い） */
const FALLBACK_TIME_ZONE = 'UTC';

/** どちらのモードでも付ける指示 */
const COMMON_RULES = [
  '「最新」「今年」「現在」「最近」などは、この日時を基準に解釈すること',
  'あなたの知識はこの日時より古い可能性がある',
];

/** エージェントモード（Web 検索ができる）で足す指示 */
const AGENT_RULES = [
  '検索語に年を入れる場合は、この日時の年を使うこと',
  '知識と検索結果が食い違う場合は、日付の新しい検索結果を優先すること',
];

/** 通常モード（ツールなし）で足す指示 */
const CHAT_RULES = [
  'この会話では Web 検索ができない。最新の情報を聞かれたら、この日時の時点の情報として断定しないこと。「学習した時点の知識では」と前置きし、それより新しいものが出ている可能性を添えること',
];

/** 日時の文を組み立てる条件。 */
export type CurrentDateOptions = {
  /** 現在の日時（route では `new Date()`。テストでは固定した値を渡す） */
  now: Date;
  /** 表示に使う IANA タイムゾーン（例: `Asia/Tokyo`）。不正なら UTC で表示する */
  timeZone: string;
  /** エージェントモードか。Web 検索ができるかで、足す指示が変わる */
  enableTools: boolean;
};

/**
 * この PC（サーバー）のタイムゾーンを返す。
 *
 * アプリは localhost で使うため、サーバーとブラウザのタイムゾーンは同じになる。
 *
 * @returns IANA タイムゾーン名。取得できなければ `UTC`
 */
export function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE;
}

/**
 * 日時を「2026年10月24日（土）09:05（Asia/Tokyo、UTC+09:00）」の形にする。
 *
 * @param now - 表示する日時
 * @param timeZone - 表示に使う IANA タイムゾーン
 * @returns 日付・曜日・時刻・タイムゾーン・UTC との差を含む文字列
 * @throws {RangeError} タイムゾーンが不正な場合（呼び出し側で UTC にフォールバックする）
 */
function formatDateTime(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  // longOffset は「GMT+09:00」の形で、UTC そのものは「GMT」だけになる
  const gmt = get('timeZoneName');
  const utcOffset =
    gmt === 'GMT' || gmt === '' ? 'UTC+00:00' : gmt.replace(/^GMT/, 'UTC');

  return `${get('year')}年${get('month')}月${get('day')}日（${get('weekday')}）${get('hour')}:${get('minute')}（${timeZone}、${utcOffset}）`;
}

/**
 * システムプロンプトに付ける「現在の日時」の節を組み立てる。
 *
 * @param options - 現在の日時・タイムゾーン・モード
 * @returns 見出し・日時・モードごとの指示からなる Markdown の節
 */
export function buildCurrentDateNotice({
  now,
  timeZone,
  enableTools,
}: CurrentDateOptions): string {
  let dateTime: string;
  try {
    dateTime = formatDateTime(now, timeZone);
  } catch {
    dateTime = formatDateTime(now, FALLBACK_TIME_ZONE);
  }
  const rules = [...COMMON_RULES, ...(enableTools ? AGENT_RULES : CHAT_RULES)];
  return [HEADING, dateTime, '', ...rules.map((rule) => `- ${rule}`)].join(
    '\n'
  );
}

/**
 * システムプロンプトの後ろに「現在の日時」の節を足す。
 *
 * 会話の途中に system メッセージを置くとテンプレートによって無視・破損されるため、
 * 別の system メッセージにはせず、先頭の 1 つにまとめる。
 *
 * @param systemPrompt - 会話の役割（とエージェントのプリセット）。空・空白のみ・未指定なら日時の節だけを返す
 * @param options - 現在の日時・タイムゾーン・モード
 * @returns 前後の空白を除いたシステムプロンプトと、日時の節を空行でつないだもの
 */
export function withCurrentDate(
  systemPrompt: string | undefined,
  options: CurrentDateOptions
): string {
  const notice = buildCurrentDateNotice(options);
  const trimmed = systemPrompt?.trim();
  return trimmed ? `${trimmed}\n\n${notice}` : notice;
}
