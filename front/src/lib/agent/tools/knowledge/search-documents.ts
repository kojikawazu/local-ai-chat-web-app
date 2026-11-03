import {
  MAX_SEARCH_DOCUMENTS_QUERY_CHARS,
  SEARCH_DOCUMENTS_TOOL_NAME,
} from '@/constants/knowledge/search-documents';
import { buildKnowledgePrompt } from '@/lib/knowledge/prompt';
import { EmbeddingModelNotFoundError } from '@/lib/llm/ollama';
import {
  EmbeddingUnavailableError,
  searchKnowledge,
} from '@/lib/server/knowledge';
import type { KnowledgeHit } from '@/types/knowledge/document';
import { toolError } from '../output';
import type { Tool } from '../types';

/**
 * 利用者が登録したドキュメント・メモ（RAG の索引）から、語句に近い部分を探すツール（#26。`docs/29-multi-agent.md`
 * 「登録したドキュメントを探すツール」）。
 *
 * サブエージェントの `reader` だけが使う（`subAgentOnly`。メインには「ドキュメントを参照」の切り替えがあるため出さない）。
 * 探し方（しきい値・件数・違う埋め込みのモデルのドキュメントを比べない）と結果の並べ方は、会話での参照（#17 Phase B）と同じ。
 * 登録したドキュメントは手元の情報のため `access: 'local'`（読んだ後は外部と通信するツールを止める）。
 */
export const searchDocumentsTool: Tool = {
  access: 'local',
  subAgentOnly: true,
  definition: {
    name: SEARCH_DOCUMENTS_TOOL_NAME,
    description:
      '利用者が登録したドキュメント・メモから、query に近い部分を探して返す（意味の近さで探す。見つかった部分の名前・見出し・本文）',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: `探す内容（${MAX_SEARCH_DOCUMENTS_QUERY_CHARS} 字まで。キーワードより、探したいことを短い文で書く）`,
        },
      },
      required: ['query'],
    },
  },
  async execute(args) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return toolError('query に探す内容を書いてください');
    if (Array.from(query).length > MAX_SEARCH_DOCUMENTS_QUERY_CHARS) {
      return toolError(
        `query は ${MAX_SEARCH_DOCUMENTS_QUERY_CHARS} 字までにしてください`
      );
    }

    let hits: KnowledgeHit[];
    try {
      hits = await searchKnowledge(query);
    } catch (error) {
      if (error instanceof EmbeddingModelNotFoundError) {
        return toolError(
          `埋め込みのモデル（${error.model}）が無いため探せません`
        );
      }
      if (error instanceof EmbeddingUnavailableError) {
        console.error('search_documents (embedding):', error.cause);
        return toolError(
          '埋め込みを作れないため探せません（Ollama が動いているか確かめてください）'
        );
      }
      console.error('search_documents:', error);
      return toolError('ドキュメントを探せませんでした');
    }

    if (hits.length === 0) {
      return {
        result: '近い部分は見つかりませんでした',
        isError: false,
        isEmpty: true,
        summary: '0 件',
      };
    }
    return {
      result: buildKnowledgePrompt(hits),
      isError: false,
      summary: `${hits.length} 件`,
    };
  },
};
