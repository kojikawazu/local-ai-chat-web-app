import type {
  PhrasingContent,
  Root as MdastRoot,
  RootContent,
  TableCell,
} from 'mdast';
import { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { getDiagramKind } from '@/lib/chat/diagram';
import {
  formatDateTime,
  normalizeTitle,
  ROLE_HEADINGS,
} from '@/lib/chat/export';
import { diagramKey } from '@/lib/chat/report-html';
import type { ReportImage, ReportInput } from '@/lib/chat/report-html';
import { getRoleLabel } from '@/lib/chat/system-prompt';

/**
 * 書き出しの文書の中間の形（#36。`docs/25-docx-export.md`「文書の中間の形」）と、Markdown からそれを作る純関数群。
 *
 * Markdown（mdast）を、Word・スライドに移しやすいブロックの並びにする。`docx` などの出力のライブラリには依存しない。
 * 解釈と安全策は HTML レポート（`report-html.ts`）と揃える: remark-parse・remark-gfm で読み、生の HTML は文字にし、
 * リンクは react-markdown と同じ `defaultUrlTransform` で検査し、本文の画像は埋め込まずにリンクか文字にする。
 */

/** 文字の並びの 1 片。 */
export type InlineRun =
  | {
      /** 文字 */
      type: 'text';
      /** 文字列 */
      text: string;
      /** 太字 */
      bold?: boolean;
      /** 斜体 */
      italic?: boolean;
      /** 取り消し線 */
      strike?: boolean;
      /** インラインのコード（等幅） */
      code?: boolean;
      /** リンクの URL（検査済み。危ない URL は付けない） */
      link?: string;
    }
  | {
      /** 段落の中の改行 */
      type: 'break';
    };

/** 埋め込む画像（図の PNG・添付画像）。 */
export type DocImage = {
  /** 画像のバイト列 */
  data: Uint8Array;
  /** 形式 */
  mimeType: 'image/png' | 'image/jpeg';
  /** 表示の幅（px） */
  width: number;
  /** 表示の高さ（px） */
  height: number;
  /** 代わりの文字 */
  alt: string;
};

/** リストの 1 項目。 */
export type DocListItem = {
  /** タスクのチェック（タスクでない項目は `null`） */
  checked: boolean | null;
  /** 項目の中身 */
  blocks: DocBlock[];
};

/** 文書のブロック。 */
export type DocBlock =
  | {
      /** 見出し */
      type: 'heading';
      /** Markdown の段階（1〜6。出力の見出しの段階は出力側で決める） */
      depth: number;
      /** 文字の並び */
      runs: InlineRun[];
    }
  | {
      /** 段落 */
      type: 'paragraph';
      /** 文字の並び */
      runs: InlineRun[];
    }
  | {
      /** リスト */
      type: 'list';
      /** 番号付きか */
      ordered: boolean;
      /** 項目 */
      items: DocListItem[];
    }
  | {
      /** 表 */
      type: 'table';
      /** 列ごとの揃え */
      align: ('left' | 'center' | 'right' | null)[];
      /** 行（先頭は見出しの行）。行 → セル → 文字の並び */
      rows: InlineRun[][][];
    }
  | {
      /** コードブロック */
      type: 'code';
      /** 言語（指定なしは `null`） */
      language: string | null;
      /** 本文 */
      text: string;
    }
  | {
      /** 引用 */
      type: 'quote';
      /** 中身 */
      blocks: DocBlock[];
    }
  | {
      /** 画像（図・添付画像） */
      type: 'image';
      /** 画像 */
      image: DocImage;
    }
  | {
      /** 区切り線 */
      type: 'rule';
    }
  | {
      /** 注記（読めなかった画像・中断した応答） */
      type: 'note';
      /** 文 */
      text: string;
    };

/** 書き出しの文書の全体。 */
export type ReportDocument = {
  /** タイトル */
  title: string;
  /** タイトルの下に並べる情報（書き出した日時・会話の役割の名前） */
  meta: string[];
  /** 会話の役割の本文（会話全体のときだけ。無ければ `null`） */
  role: string | null;
  /** メッセージごとのまとまり */
  sections: {
    /** 見出し（ユーザー / アシスタント・日時） */
    heading: string;
    /** 本文 */
    blocks: DocBlock[];
  }[];
};

/** 描けた図の画像。キーは `diagramKey`（HTML レポートと同じ） */
export type DiagramImages = ReadonlyMap<string, DocImage>;

/** 埋め込んでよい添付画像の `data:` URI（PNG・JPEG の Base64 だけ。HTML レポートと同じ） */
const IMAGE_DATA_URI = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+=*)$/;

/**
 * Base64 をバイト列にする。
 *
 * @param base64 - Base64 の文字列
 * @returns バイト列
 */
function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 添付画像（HTML レポートと同じ `data:` URI の形）を、埋め込む画像にする。
 *
 * @param image - 添付画像（読めなかった画像は `null`）
 * @returns 埋め込む画像。読めなかった・形の合わない画像は `null`
 */
export function toDocImage(image: ReportImage): DocImage | null {
  const match = image ? IMAGE_DATA_URI.exec(image.dataUri) : null;
  if (!image || !match) return null;
  return {
    data: decodeBase64(match[2]),
    mimeType: match[1] === 'png' ? 'image/png' : 'image/jpeg',
    width: image.width,
    height: image.height,
    alt: '添付画像',
  };
}

/** 文字の飾り（入れ子の強調・斜体などを重ねていく） */
type Marks = Omit<Extract<InlineRun, { type: 'text' }>, 'type' | 'text'>;

/**
 * リンクの URL を react-markdown と同じ判定で検査する。
 *
 * @param url - リンクの URL
 * @returns 安全な URL。危ない・空なら `undefined`
 */
function safeUrl(url: string): string | undefined {
  return (url && defaultUrlTransform(url)) || undefined;
}

/**
 * 文字の並び（mdast の phrasing content）を、文字の片の並びにする。
 *
 * @param nodes - mdast の子
 * @param marks - 外側から受け継いだ飾り
 * @returns 文字の片の並び
 */
function toRuns(nodes: PhrasingContent[], marks: Marks = {}): InlineRun[] {
  return nodes.flatMap((node): InlineRun[] => {
    switch (node.type) {
      case 'text':
        return [{ type: 'text', text: node.value, ...marks }];
      case 'strong':
        return toRuns(node.children, { ...marks, bold: true });
      case 'emphasis':
        return toRuns(node.children, { ...marks, italic: true });
      case 'delete':
        return toRuns(node.children, { ...marks, strike: true });
      case 'inlineCode':
        return [{ type: 'text', text: node.value, ...marks, code: true }];
      case 'break':
        return [{ type: 'break' }];
      case 'link': {
        const link = safeUrl(node.url);
        return toRuns(node.children, link ? { ...marks, link } : marks);
      }
      case 'linkReference':
        return toRuns(node.children, marks);
      case 'image': {
        // 本文の画像は埋め込まない（開いたときに外部へ読みに行かせない）。安全な URL ならリンクにする
        const link = safeUrl(node.url);
        const text = `［画像: ${node.alt || '画像'}］`;
        return [{ type: 'text', text, ...marks, ...(link && { link }) }];
      }
      case 'imageReference':
        return [
          { type: 'text', text: `［画像: ${node.alt || '画像'}］`, ...marks },
        ];
      case 'html':
        // 生の HTML はタグにせず、文字として出す（HTML レポート・画面と同じ）
        return [{ type: 'text', text: node.value, ...marks }];
      case 'footnoteReference':
        return [{ type: 'text', text: `[^${node.identifier}]`, ...marks }];
      default:
        return [];
    }
  });
}

/**
 * 表のセルを文字の並びにする。
 *
 * @param cell - 表のセル
 * @returns 文字の並び
 */
function cellRuns(cell: TableCell): InlineRun[] {
  return toRuns(cell.children);
}

/**
 * mdast のブロックを、文書のブロックにする。
 *
 * @param nodes - mdast のブロック
 * @param diagrams - 描けた図の画像
 * @returns 文書のブロック
 */
function toBlocks(nodes: RootContent[], diagrams: DiagramImages): DocBlock[] {
  return nodes.flatMap((node): DocBlock[] => {
    switch (node.type) {
      case 'heading':
        return [
          { type: 'heading', depth: node.depth, runs: toRuns(node.children) },
        ];
      case 'paragraph':
        return [{ type: 'paragraph', runs: toRuns(node.children) }];
      case 'list':
        return [
          {
            type: 'list',
            ordered: node.ordered === true,
            items: node.children.map((item) => ({
              checked: typeof item.checked === 'boolean' ? item.checked : null,
              blocks: toBlocks(item.children, diagrams),
            })),
          },
        ];
      case 'table':
        return [
          {
            type: 'table',
            align: node.align ?? [],
            rows: node.children.map((row) => row.children.map(cellRuns)),
          },
        ];
      case 'code': {
        const kind = getDiagramKind(node.lang ?? null);
        const image = kind
          ? diagrams.get(diagramKey(kind, node.value))
          : undefined;
        if (image) return [{ type: 'image', image }];
        return [
          { type: 'code', language: node.lang ?? null, text: node.value },
        ];
      }
      case 'blockquote':
        return [{ type: 'quote', blocks: toBlocks(node.children, diagrams) }];
      case 'thematicBreak':
        return [{ type: 'rule' }];
      case 'html':
        return [
          { type: 'paragraph', runs: [{ type: 'text', text: node.value }] },
        ];
      default:
        // 定義（[x]: url）・脚注の定義などは本文に出さない
        return [];
    }
  });
}

/**
 * Markdown を文書のブロックにする。
 *
 * @param markdown - Markdown の本文
 * @param diagrams - 描けた図の画像（描けなかった図はコードブロックのまま）
 * @returns 文書のブロック
 */
export function markdownToBlocks(
  markdown: string,
  diagrams: DiagramImages
): DocBlock[] {
  const processor = unified().use(remarkParse).use(remarkGfm);
  const tree = processor.runSync(processor.parse(markdown)) as MdastRoot;
  return toBlocks(tree.children, diagrams);
}

/**
 * user のメッセージの本文を段落にする（Markdown にせず、改行を保つ。画面・HTML レポートと同じ）。
 *
 * @param content - 本文
 * @returns 段落
 */
function plainParagraph(content: string): DocBlock {
  const runs: InlineRun[] = [];
  content.split('\n').forEach((line, index) => {
    if (index > 0) runs.push({ type: 'break' });
    if (line) runs.push({ type: 'text', text: line });
  });
  return { type: 'paragraph', runs };
}

/**
 * 書き出しの文書の全体を組み立てる（中身は HTML レポートと同じ）。
 *
 * 会話全体: タイトル・書き出した日時・会話の役割と、メッセージを「ユーザー / アシスタント（日時）」の見出しで並べる。
 * 応答 1 件: タイトルと「アシスタント（日時）」の下に、その応答の本文だけを置く。
 * 添付画像は本文の前に置き、読めなかった画像・中断した応答には注記を付ける。
 *
 * @param input - レポートの中身（HTML レポートと同じ）
 * @param diagrams - 描けた図の画像
 * @returns 文書の全体
 */
export function buildReportDocument(
  input: ReportInput,
  diagrams: DiagramImages
): ReportDocument {
  const role = input.systemPrompt?.trim() || null;
  const showRole = input.mode === 'conversation' && role !== null;
  return {
    title: normalizeTitle(input.title),
    meta: [
      `書き出した日時: ${formatDateTime(input.exportedAt)}`,
      ...(showRole && role ? [`会話の役割: ${getRoleLabel(role)}`] : []),
    ],
    role: showRole ? role : null,
    sections: input.messages.map((message) => {
      const blocks: DocBlock[] = message.images.map((image) => {
        const docImage = toDocImage(image);
        return docImage
          ? { type: 'image', image: docImage }
          : { type: 'note', text: '（画像を読み込めませんでした）' };
      });
      blocks.push(
        ...(message.role === 'user'
          ? [plainParagraph(message.content)]
          : markdownToBlocks(message.content, diagrams))
      );
      if (message.interrupted) {
        blocks.push({ type: 'note', text: '（生成を中断した応答）' });
      }
      return {
        heading: `${ROLE_HEADINGS[message.role]}（${formatDateTime(message.createdAt)}）`,
        blocks,
      };
    }),
  };
}
