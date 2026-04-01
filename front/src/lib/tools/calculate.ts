import { Tool } from './types';

export const calculateTool: Tool = {
  definition: {
    name: 'calculate',
    description: '数式を計算して結果を返す。四則演算と括弧に対応',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '計算式 (例: 2 + 3 * 4, (10 - 2) / 4)',
        },
      },
      required: ['expression'],
    },
  },
  execute: async (args) => {
    const expression = typeof args.expression === 'string' ? args.expression : '';

    if (!expression.trim()) {
      return 'エラー: 計算式が空です';
    }

    // 前処理: 許可する文字のみかチェック（数字、四則演算子、括弧、小数点、空白）
    if (!/^[\d\s+\-*/().]+$/.test(expression)) {
      return 'エラー: 使用できない文字が含まれています。数字と四則演算子(+ - * /)と括弧のみ使用できます';
    }

    try {
      const result = parseExpression(expression.replace(/\s/g, ''));
      if (!isFinite(result)) {
        return 'エラー: 計算結果が不正です（ゼロ除算等）';
      }
      // 浮動小数点の誤差を考慮して適切な精度で返す
      const formatted =
        Number.isInteger(result) ? String(result) : String(parseFloat(result.toPrecision(12)));
      return `${expression.trim()} = ${formatted}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '不明なエラー';
      return `エラー: ${msg}`;
    }
  },
};

// 再帰下降パーサー
// 文法:
//   expression = term (('+' | '-') term)*
//   term       = factor (('*' | '/') factor)*
//   factor     = '-' factor | '(' expression ')' | number

type Parser = { input: string; pos: number };

function parseExpression(input: string): number {
  const p: Parser = { input, pos: 0 };
  const result = parseExpr(p);
  if (p.pos !== p.input.length) {
    throw new Error('計算式の形式が正しくありません');
  }
  return result;
}

function parseExpr(p: Parser): number {
  let left = parseTerm(p);
  while (p.pos < p.input.length) {
    const ch = p.input[p.pos];
    if (ch === '+' || ch === '-') {
      p.pos++;
      const right = parseTerm(p);
      left = ch === '+' ? left + right : left - right;
    } else {
      break;
    }
  }
  return left;
}

function parseTerm(p: Parser): number {
  let left = parseFactor(p);
  while (p.pos < p.input.length) {
    const ch = p.input[p.pos];
    if (ch === '*' || ch === '/') {
      p.pos++;
      const right = parseFactor(p);
      left = ch === '*' ? left * right : left / right;
    } else {
      break;
    }
  }
  return left;
}

function parseFactor(p: Parser): number {
  if (p.pos >= p.input.length) {
    throw new Error('計算式が不完全です');
  }

  // 単項マイナス
  if (p.input[p.pos] === '-') {
    p.pos++;
    return -parseFactor(p);
  }

  // 括弧
  if (p.input[p.pos] === '(') {
    p.pos++; // '(' を消費
    const result = parseExpr(p);
    if (p.pos >= p.input.length || p.input[p.pos] !== ')') {
      throw new Error('括弧が閉じられていません');
    }
    p.pos++; // ')' を消費
    return result;
  }

  // 数値
  return parseNumber(p);
}

function parseNumber(p: Parser): number {
  const start = p.pos;
  // 整数部
  while (p.pos < p.input.length && /\d/.test(p.input[p.pos])) {
    p.pos++;
  }
  // 小数部
  if (p.pos < p.input.length && p.input[p.pos] === '.') {
    p.pos++;
    while (p.pos < p.input.length && /\d/.test(p.input[p.pos])) {
      p.pos++;
    }
  }
  if (p.pos === start) {
    throw new Error(`計算式の形式が正しくありません (位置: ${p.pos})`);
  }
  return parseFloat(p.input.slice(start, p.pos));
}
