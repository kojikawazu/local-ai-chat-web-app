/**
 * 応答の本文をスライドに分ける純関数群（#36。`docs/26-html-slides-export.md`「スライドの分け方」）。
 *
 * 本文の最上位のブロックの並びを、区切り線か見出しで分ける。ブロックの形は出力ごとに違う（HTML は hast の要素、
 * PPTX は文書の中間の形の `DocBlock`）ため、ブロックの種類は呼び出し側が渡す関数で決める。
 */

/** スライドの分け方から見たブロックの種類。 */
export type SlideBlockKind =
  | {
      /** 区切り線（`---`） */
      type: 'rule';
    }
  | {
      /** 見出し */
      type: 'heading';
      /** Markdown の段階（1〜6） */
      depth: number;
    }
  | {
      /** 段落 */
      type: 'paragraph';
    }
  | {
      /** 中身のない空白（hast の要素の間の改行など）。スライドの中身として数えない */
      type: 'blank';
    }
  | {
      /** そのほか（リスト・表・コード・図・引用など） */
      type: 'other';
    };

/** 1 枚のスライド。 */
export type Slide<T> = {
  /** スライドに入れるブロック（区切り線は含めない） */
  blocks: T[];
  /** 表紙の見た目にするか（1 枚目で、見出しと段落だけのとき） */
  cover: boolean;
};

/** 区切り線が無いとき、この段階までの見出しは必ずスライドを分ける（`#` だけ・`##` だけの本文でも 1 章 1 枚にする） */
const MIN_SPLIT_DEPTH = 2;

/**
 * 先頭の front matter。先頭の空行を許し、閉じの `---` までの行（1 つ目のグループ）を最短で取る。
 * 閉じの `---` は行末か本文の終わり
 */
const FRONT_MATTER = /^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** front matter の 1 行目の形（YAML のキー `key:`） */
const FRONT_MATTER_KEY = /^[A-Za-z_$][\w$-]*[ \t]*:/;

/**
 * ブロックの並びをスライドに分ける。
 *
 * 1. 区切り線が 1 つでもあれば、区切り線で分ける（見出しでは分けない）。区切り線はスライドに入れない
 * 2. 区切り線が無ければ、最も浅い見出しの段階を `d` として、段階が `max(d, 2)` 以下の見出しの前で分ける
 * 3. どちらも無ければ 1 枚にする
 *
 * 中身のない（空白だけの）スライドは捨てる。2 枚以上あり、1 枚目が見出しを含み見出しと段落だけなら表紙にする。
 *
 * @param blocks - 本文の最上位のブロック（現れた順）
 * @param kindOf - ブロックの種類を返す関数
 * @returns スライド（中身が無ければ空の配列）
 */
export function splitSlides<T>(
  blocks: readonly T[],
  kindOf: (block: T) => SlideBlockKind
): Slide<T>[] {
  const kinds = blocks.map(kindOf);
  const hasRule = kinds.some((kind) => kind.type === 'rule');
  const depths = kinds.flatMap((kind) =>
    kind.type === 'heading' ? [kind.depth] : []
  );
  const splitDepth =
    depths.length > 0 ? Math.max(Math.min(...depths), MIN_SPLIT_DEPTH) : 0;

  const groups: { block: T; kind: SlideBlockKind }[][] = [[]];
  blocks.forEach((block, index) => {
    const kind = kinds[index];
    if (hasRule) {
      if (kind.type === 'rule') {
        groups.push([]);
        return;
      }
    } else if (kind.type === 'heading' && kind.depth <= splitDepth) {
      groups.push([]);
    }
    groups[groups.length - 1].push({ block, kind });
  });

  const slides = groups.filter((group) =>
    group.some(({ kind }) => kind.type !== 'blank')
  );
  return slides.map((group, index) => ({
    blocks: group.map(({ block }) => block),
    cover: index === 0 && slides.length > 1 && isCoverLike(group),
  }));
}

/**
 * スライドが表紙の見た目に向くか（見出しを含み、見出しと段落だけ）を判定する。
 *
 * @param group - スライドのブロックと種類
 * @returns 表紙に向くなら true
 */
function isCoverLike(group: { kind: SlideBlockKind }[]): boolean {
  const kinds = group.map(({ kind }) => kind.type);
  return (
    kinds.includes('heading') &&
    kinds.every(
      (type) => type === 'heading' || type === 'paragraph' || type === 'blank'
    )
  );
}

/**
 * 本文の先頭の front matter（`---` で囲んだ `key: value` の行。Marp の `marp: true` など）を取り除く。
 *
 * 残すと、先頭の `---` が区切り線に、閉じの `---` が直前の行を見出しにする setext の下線に読まれ、1 枚目が壊れる。
 * 囲みの 1 行目が `key:` の形でなければ front matter とみなさず、そのまま返す（ふつうの区切り線で始まる本文を消さない）。
 *
 * @param markdown - Markdown の本文
 * @returns front matter を除いた本文
 */
export function stripFrontMatter(markdown: string): string {
  const match = FRONT_MATTER.exec(markdown);
  if (!match || !FRONT_MATTER_KEY.test(match[1])) return markdown;
  return markdown.slice(match[0].length);
}
