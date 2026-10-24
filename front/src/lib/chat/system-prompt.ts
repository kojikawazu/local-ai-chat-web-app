/**
 * 会話の役割（システムプロンプト）のプリセットと、`/api/chat` へ送るシステムプロンプトの組み立て（#10）。
 *
 * 役割は会話ごとに本文だけを DB に保存する（プリセットの ID は保存しない）。プリセットは入力の
 * ひな形で、選んだ後に書き換えてもよい。表示名は保存された本文から逆引きする（{@link getRoleLabel}）。
 */

/** 会話の役割のプリセット 1 件。 */
export type RolePreset = {
  /** プリセットを一意に識別する ID（UI の key・テストの参照に使う） */
  id: string;
  /** UI に表示するプリセット名 */
  name: string;
  /** 役割の本文（会話の `systemPrompt` として保存される） */
  prompt: string;
};

/** 選択できる役割のプリセット。「役割なし」はプリセットではなく空の役割で表す。 */
export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    id: 'translator',
    name: '翻訳者',
    prompt:
      'あなたは優秀な翻訳者です。日本語の文は英語に、英語の文は日本語に、自然な表現で翻訳してください。訳文だけを返し、補足が必要な場合は訳文の後に短く添えてください。',
  },
  {
    id: 'code-reviewer',
    name: 'コードレビュアー',
    prompt:
      'あなたは経験豊富なソフトウェアエンジニアです。渡されたコードをレビューし、不具合・可読性・性能・セキュリティの観点で改善点を、重要なものから順に根拠とともに指摘してください。',
  },
  {
    id: 'japanese-teacher',
    name: '日本語教師',
    prompt:
      'あなたは日本語教師です。日本語の文法や表現の質問に、例文を交えて丁寧に答えてください。誤りのある文が渡されたら、正しい文と誤りの理由を示してください。',
  },
];

/** 役割が無いときの表示名。 */
export const NO_ROLE_LABEL = '役割なし';
/** プリセットに一致しない（書き換えた・自由に入力した）役割の表示名。 */
export const CUSTOM_ROLE_LABEL = 'カスタム';

/**
 * 保存された役割の本文から表示名を求める。
 *
 * @param systemPrompt - 会話の役割（未設定は `null` / 空文字）
 * @returns 空なら「役割なし」、プリセットの本文と一致すればその名前、それ以外は「カスタム」
 */
export function getRoleLabel(systemPrompt: string | null | undefined): string {
  const trimmed = systemPrompt?.trim();
  if (!trimmed) return NO_ROLE_LABEL;
  return (
    ROLE_PRESETS.find((preset) => preset.prompt === trimmed)?.name ??
    CUSTOM_ROLE_LABEL
  );
}

/**
 * `/api/chat` へ送るシステムプロンプトを組み立てる。
 *
 * 会話の役割を先に、エージェントのプリセット（ツールの使い方・調査の進め方）を後に置き、
 * 空行で区切って 1 つにする。役割は「誰として答えるか」、エージェントのプリセットは
 * 「どう調べて答えるか」で関心が分かれるため、両方を生かす。
 *
 * @param rolePrompt - 会話の役割（未設定は空文字）
 * @param agentPrompt - エージェントモードのプリセットの本文（通常モード・プリセットなしは空文字）
 * @returns 連結したシステムプロンプト。どちらも空なら空文字（`/api/chat` へ送らない）
 */
export function buildSystemPrompt(
  rolePrompt: string,
  agentPrompt: string
): string {
  return [rolePrompt.trim(), agentPrompt.trim()]
    .filter((part) => part.length > 0)
    .join('\n\n');
}
