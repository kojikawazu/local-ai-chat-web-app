import Mark from '@/components/common/atoms/Mark';

/** {@link HighlightedText} の props。 */
type HighlightedTextProps = {
  /**
   * 元の順に並べた文字列の片。`match` の片を強調する。
   * 分け方（キーワードの解釈）は呼び出し側が決める（会話の検索・ブックマークの一覧は `splitHighlights`）
   */
  parts: { text: string; match: boolean }[];
};

/**
 * 文字列の片を並べ、一致した片だけを {@link Mark} で強調して描く（共通の molecule）。
 *
 * HTML を組み立てずに、片を React の要素として並べる（XSS 対策。`security.md`）。
 * 会話の検索の結果（#11）と、ブックマークの一覧（#30）で使う。
 *
 * @param props - 描く文字列の片
 */
export default function HighlightedText({ parts }: HighlightedTextProps) {
  return (
    <>
      {parts.map((part, i) =>
        part.match ? (
          <Mark key={i}>{part.text}</Mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}
