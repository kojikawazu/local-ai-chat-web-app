/**
 * サイドバーの一覧の行（会話の履歴・検索の結果）に付ける目印の属性（#33）。
 *
 * ↑↓・Home・End でフォーカスを移すとき（`useListNavigation`）に、この属性を持つ要素だけを行として数える
 * （削除のボタン等を飛ばすため）。行の部品（`ConversationListItem`・`SearchResultItem`）が付ける。
 */
export const LIST_ITEM_ATTRIBUTE = 'data-list-item';
