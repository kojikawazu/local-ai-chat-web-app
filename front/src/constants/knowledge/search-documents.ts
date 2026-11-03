/** 登録したドキュメントを探すツールの名前（#26。サブエージェントの `reader` だけが使う。`docs/29-multi-agent.md`） */
export const SEARCH_DOCUMENTS_TOOL_NAME = 'search_documents';

/** 探す語句（`query`）の上限（文字）。探す語句のため長くは要らず、埋め込みのモデルの入力を超えない */
export const MAX_SEARCH_DOCUMENTS_QUERY_CHARS = 500;
