/** {@link WebSearchResult} の props。 */
type WebSearchResultProps = {
  /** web_search ツールの結果テキスト（`[N] タイトル\n    URL: https://...\n    スニペット` の並び） */
  text: string;
};

/** 結果テキストから取り出した検索結果の 1 件 */
type WebSearchItem = {
  /** 結果の番号（`[N]` の N） */
  index: string;
  /** ページのタイトル */
  title: string;
  /** ページの URL（無ければ空文字） */
  url: string;
  /** 抜粋（無ければ空文字） */
  snippet: string;
};

/**
 * web_search ツールの結果テキストをリンク付きの検索結果一覧に整形して表示する（#163 で `ToolCallResult` から切り出し）。
 *
 * `[N] タイトル\n    URL: https://...\n    スニペット` という素朴なテキスト形式を
 * 正規表現でブロック分割してパースする。パースできない（1 件も抽出できない）場合は
 * 元テキストをそのまま表示するフォールバックにする。
 *
 * @param props - web_search の生結果テキストを持つ props
 */
export function WebSearchResult({ text }: WebSearchResultProps) {
  // "[N] タイトル\n    URL: https://...\n    スニペット" 形式をパース
  const blocks = text.split(/\[(\d+)\] /).slice(1);
  const items: WebSearchItem[] = [];

  for (let i = 0; i < blocks.length; i += 2) {
    const index = blocks[i];
    const body = blocks[i + 1] ?? '';
    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const title = lines[0] ?? '';
    const urlLine = lines.find((l) => l.startsWith('URL:'));
    const url = urlLine ? urlLine.replace('URL:', '').trim() : '';
    const snippet = lines
      .filter((l) => !l.startsWith('URL:'))
      .slice(1)
      .join(' ');
    items.push({ index, title, url, snippet });
  }

  if (items.length === 0) {
    return <p className="text-xs text-[var(--color-nord-4)]">{text}</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.index} className="text-xs">
          <p className="font-medium text-[var(--color-nord-8)]">
            [{item.index}]{' '}
            {item.url && item.url.startsWith('http') ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--color-nord-9)] transition-colors"
              >
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </p>
          {item.snippet && (
            <p className="text-[var(--color-nord-4)] opacity-80 mt-0.5">
              {item.snippet}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
