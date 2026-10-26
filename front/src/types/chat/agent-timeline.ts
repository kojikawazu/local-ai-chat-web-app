import type { ToolCallInfo } from '@/types/agent/tool-call';

/** エージェントの応答の時系列の 1 項目（#186）。 */
export type AgentTimelineStep =
  | {
      /** 本文の断片（ツールの前の説明） */
      kind: 'text';
      /** 断片の本文 */
      text: string;
    }
  | {
      /** 同じ位置で呼んだツールの結果のまとまり */
      kind: 'tools';
      /** 呼んだ順のツール呼び出し */
      toolCalls: ToolCallInfo[];
    };

/** エージェントの応答を、本文とツールの結果の時系列に並べ直したもの（#186）。 */
export type AgentTimeline = {
  /** 回答より前の項目（説明の本文とツールの結果を、呼んだ順に交互に並べたもの） */
  steps: AgentTimelineStep[];
  /** 最後のツールの後の本文（回答）。まだ届いていなければ空文字 */
  answer: string;
};
