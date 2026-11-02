import type { KnowledgeFileKind } from './file';

/**
 * ドキュメントを分けた 1 つ（保存の前。#17）。
 */
export type KnowledgeChunkDraft = {
  /** 見出しの経路（`範囲 > 含める`）。見出しの前・テキストのファイルなら空 */
  heading: string;
  /** 本文 */
  content: string;
};

/**
 * チャンクの目安の文字数（#17）。ここまで段落をまとめる。
 *
 * docs で比べて 600 字と 1200 字の精度が同じだったため、モデルへ渡す量の少ない 600 字にした（`docs/28-rag.md`）。
 */
const TARGET_LENGTH = 600;

/**
 * 1 つのまとまり（段落・コードブロック）をそのまま 1 つのチャンクにしてよい最大の文字数（#17）。
 *
 * 超えたら文の終わり・行の区切りで分ける。大きなまとまりが 1 つのチャンクを占めないため。
 */
const MAX_LENGTH = TARGET_LENGTH * 1.5;

/** Markdown の見出し（`#`〜`###`）。それより深い見出しは本文として扱う（節を細かくしすぎないため） */
const HEADING = /^ {0,3}(#{1,3})[ \t]+(.+?)[ \t#]*$/;

/** コードブロックの囲み（` ``` ` / `~~~`）。開始と同じ記号で閉じる */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** 文の終わり（ここで分けてよい位置）。日本語の句点・感嘆符・疑問符、英語の文末（後ろに空白） */
const SENTENCE_END = /(?<=[。．！？!?]|\.(?=\s))/;

/**
 * 本文の中のまとまり。コードブロックは中の空行で分けないため、段落と区別する。
 */
type Block = { text: string; code: boolean };

/**
 * ドキュメントの本文をチャンクに分ける（#17。`docs/28-rag.md`「チャンクの分け方」）。
 *
 * Markdown は見出し（`#`〜`###`）で節に分け、見出しの経路を各チャンクに持たせる。節の中（テキストは全体）を
 * 空行の位置で約 600 字ずつにまとめる。コードブロックは空行でも分けない。1 つのまとまりが 900 字を超えるときは、
 * 段落は文の終わりで、コードブロックは行の区切りで分ける（それも無ければ 600 字で切る）。
 *
 * @param content - 本文（改行は `\n` にそろえた後）
 * @param kind - ドキュメントの種類
 * @returns チャンクの並び（本文の順）。空白だけのチャンクは作らない
 */
export function chunkDocument(
  content: string,
  kind: KnowledgeFileKind
): KnowledgeChunkDraft[] {
  const chunks: KnowledgeChunkDraft[] = [];
  const headingPath: string[] = [];
  let blocks: Block[] = [];
  let paragraph: string[] = [];
  let fence: string | null = null;
  let code: string[] = [];

  const endParagraph = () => {
    const text = paragraph.join('\n').trim();
    if (text) blocks.push({ text, code: false });
    paragraph = [];
  };
  const endSection = () => {
    endParagraph();
    chunks.push(...packBlocks(blocks, headingPath.join(' > ')));
    blocks = [];
  };

  for (const line of content.split('\n')) {
    if (fence !== null) {
      code.push(line);
      if (line.trimStart().startsWith(fence)) {
        blocks.push({ text: code.join('\n'), code: true });
        fence = null;
        code = [];
      }
      continue;
    }

    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      endParagraph();
      fence = fenceMatch[1];
      code = [line];
      continue;
    }

    const heading = kind === 'markdown' ? HEADING.exec(line) : null;
    if (heading) {
      endSection();
      const level = heading[1].length;
      headingPath.length = level - 1;
      // 飛ばした階層（# の次に ###）は空のまま詰める
      for (let i = 0; i < level - 1; i++) headingPath[i] ??= '';
      headingPath[level - 1] = heading[2].trim();
      continue;
    }

    if (line.trim() === '') {
      endParagraph();
    } else {
      paragraph.push(line);
    }
  }

  // 閉じていないコードブロックは、最後までをコードとして扱う
  if (fence !== null) blocks.push({ text: code.join('\n'), code: true });
  endSection();
  return chunks;
}

/**
 * 1 つの節のまとまりを、目安の文字数までまとめてチャンクにする。
 *
 * @param blocks - 節の中のまとまり（本文の順）
 * @param heading - 節の見出しの経路
 * @returns チャンクの並び
 */
function packBlocks(blocks: Block[], heading: string): KnowledgeChunkDraft[] {
  const chunks: KnowledgeChunkDraft[] = [];
  let buffer = '';
  const flush = () => {
    const text = buffer.trim();
    if (text) chunks.push({ heading: cleanHeading(heading), content: text });
    buffer = '';
  };

  for (const block of blocks) {
    const joined = buffer ? `${buffer}\n\n${block.text}` : block.text;
    if (joined.length <= TARGET_LENGTH) {
      buffer = joined;
      continue;
    }
    flush();
    if (block.text.length <= MAX_LENGTH) {
      buffer = block.text;
      continue;
    }
    const pieces = splitLong(block);
    // 最後の切れ端は、次のまとまりとまとめられるよう残す
    for (const piece of pieces.slice(0, -1)) {
      buffer = piece;
      flush();
    }
    buffer = pieces.at(-1) ?? '';
  }
  flush();
  return chunks;
}

/**
 * 見出しの経路の、飛ばした階層の空の要素を除く（`A >  > C` を `A > C` にする）。
 *
 * @param heading - 見出しの経路
 * @returns 空の要素を除いた経路
 */
function cleanHeading(heading: string): string {
  return heading
    .split(' > ')
    .filter((part) => part !== '')
    .join(' > ');
}

/**
 * 大きなまとまりを、目安の文字数以下の切れ端に分ける。
 *
 * 段落は文の終わりで、コードブロックは行の区切りで分ける。1 つの文・行が目安を超えるときは目安の文字数で切る。
 *
 * @param block - 分けるまとまり
 * @returns 切れ端（本文の順。どれも目安の文字数以下）
 */
function splitLong(block: Block): string[] {
  const units = block.code
    ? block.text.split(/(?<=\n)/)
    : block.text.split(SENTENCE_END);
  const pieces: string[] = [];
  let buffer = '';
  for (const unit of units.flatMap(sliceToTarget)) {
    if (buffer.length + unit.length > TARGET_LENGTH && buffer) {
      pieces.push(buffer);
      buffer = '';
    }
    buffer += unit;
  }
  if (buffer) pieces.push(buffer);
  return pieces.map((piece) => piece.trim()).filter((piece) => piece !== '');
}

/**
 * 目安の文字数を超える文・行を、目安の文字数ずつに切る。
 *
 * @param unit - 文・行
 * @returns 切ったもの（超えなければそのまま 1 つ）
 */
function sliceToTarget(unit: string): string[] {
  if (unit.length <= TARGET_LENGTH) return [unit];
  const slices: string[] = [];
  for (let i = 0; i < unit.length; i += TARGET_LENGTH) {
    slices.push(unit.slice(i, i + TARGET_LENGTH));
  }
  return slices;
}
