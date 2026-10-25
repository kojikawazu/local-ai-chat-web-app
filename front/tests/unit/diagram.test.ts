import { describe, it, expect } from 'vitest';
import {
  buildMermaidThemeVariables,
  getDiagramKind,
  svgToDataUri,
  toMermaidId,
  toPlantUmlDiagramState,
  withIntrinsicSize,
} from '@/lib/chat/diagram';

/**
 * `lib/chat/diagram` の UT（#169・#171）。
 * 図を `<img>` で表示するための、図の種類の判定・要素 ID・data: URI・SVG の大きさ・
 * テーマの色の組み立てと、PlantUML の API の応答の解釈を確かめる。純関数のため mock は使わない（CSS 変数の読み取りは表を渡す）。
 */

/** data: URI の接頭辞（`svgToDataUri` の出力の先頭） */
const DATA_URI_PREFIX = 'data:image/svg+xml;charset=utf-8,';

/**
 * data: URI から SVG の文字列に戻す。
 *
 * @param uri - `svgToDataUri` の出力
 * @returns 元の SVG の文字列
 */
function decodeDataUri(uri: string): string {
  return decodeURIComponent(uri.slice(DATA_URI_PREFIX.length));
}

/** mermaid が出すルートの `<svg>` の形（属性の並びは mermaid 12 の flowchart の出力に合わせる） */
const MERMAID_SVG =
  '<svg id="mermaid-r1" width="100%" xmlns="http://www.w3.org/2000/svg" class="flowchart" style="max-width: 120.5px;" viewBox="0 0 120.5 300" role="graphics-document document"><g><text>A</text></g></svg>';

describe('getDiagramKind', () => {
  describe('正常系', () => {
    it('mermaid は Mermaid、plantuml・puml は PlantUML と判定する', () => {
      expect(getDiagramKind('mermaid')).toBe('mermaid');
      expect(getDiagramKind('plantuml')).toBe('plantuml');
      expect(getDiagramKind('puml')).toBe('plantuml');
    });
  });

  describe('準正常系', () => {
    it('大文字が混ざっても判定する', () => {
      expect(getDiagramKind('Mermaid')).toBe('mermaid');
      expect(getDiagramKind('PlantUML')).toBe('plantuml');
      expect(getDiagramKind('PUML')).toBe('plantuml');
    });

    it('図ではない言語・似た名前は判定しない', () => {
      expect(getDiagramKind('typescript')).toBeNull();
      expect(getDiagramKind('mermaidjs')).toBeNull();
      expect(getDiagramKind('uml')).toBeNull();
    });
  });

  describe('異常系', () => {
    it('言語の指定が無い（null）・空文字は判定しない', () => {
      expect(getDiagramKind(null)).toBeNull();
      expect(getDiagramKind('')).toBeNull();
    });

    it('オブジェクトが継承するプロパティ名を図の種類と取り違えない', () => {
      expect(getDiagramKind('constructor')).toBeNull();
      expect(getDiagramKind('toString')).toBeNull();
      expect(getDiagramKind('__proto__')).toBeNull();
    });
  });
});

describe('toMermaidId', () => {
  describe('正常系', () => {
    it('useId の記号を落とし、mermaid- を前に付ける', () => {
      expect(toMermaidId(':r1:')).toBe('mermaid-r1');
      expect(toMermaidId('«r2»')).toBe('mermaid-r2');
      expect(toMermaidId('_r_3_')).toBe('mermaid-r3');
    });
  });

  describe('準正常系', () => {
    it('英数字の部分が違う useId は、記号を落としても別の ID になる', () => {
      expect(toMermaidId(':r1:')).not.toBe(toMermaidId(':r10:'));
    });
  });

  describe('異常系', () => {
    it('英数字を含まない値でも、空でない ID を返す', () => {
      expect(toMermaidId('::')).toBe('mermaid-');
    });
  });
});

describe('svgToDataUri', () => {
  describe('正常系', () => {
    it('data:image/svg+xml の URI にし、元の SVG に戻せる', () => {
      const uri = svgToDataUri(MERMAID_SVG);
      expect(uri.startsWith(DATA_URI_PREFIX)).toBe(true);
      expect(decodeDataUri(uri)).toBe(MERMAID_SVG);
    });
  });

  describe('準正常系', () => {
    it('#・%・改行・日本語を含む SVG も壊さない', () => {
      const svg =
        '<svg><style>#a{fill:#fff;width:50%}</style>\n<text>ユーザー</text></svg>';
      const uri = svgToDataUri(svg);
      // # は URI の断片の区切りとして解釈されるため、エンコードされていること
      expect(uri).not.toContain('#');
      expect(decodeDataUri(uri)).toBe(svg);
    });
  });

  describe('異常系', () => {
    it('空文字でも接頭辞だけの URI を返す', () => {
      expect(svgToDataUri('')).toBe(DATA_URI_PREFIX);
    });
  });
});

describe('withIntrinsicSize', () => {
  describe('正常系', () => {
    it('ルートの svg に viewBox の幅・高さを書き込み、width="100%" と max-width を外す', () => {
      const sized = withIntrinsicSize(MERMAID_SVG);
      const openTag = sized.match(/<svg\b[^>]*>/)?.[0] ?? '';
      expect(openTag).toContain('width="120.5"');
      expect(openTag).toContain('height="300"');
      expect(openTag).not.toContain('width="100%"');
      expect(openTag).not.toContain('max-width');
      // 本文と、ルート以外の属性は変えない
      expect(openTag).toContain('viewBox="0 0 120.5 300"');
      expect(sized).toContain('<g><text>A</text></g></svg>');
    });
  });

  describe('準正常系', () => {
    it('既に width・height があれば viewBox の値で置き換える', () => {
      const svg =
        '<svg width="10" height="20" viewBox="0,0,30,40"><rect width="5" height="5"/></svg>';
      const sized = withIntrinsicSize(svg);
      expect(sized).toBe(
        '<svg width="30" height="40" viewBox="0,0,30,40"><rect width="5" height="5"/></svg>'
      );
    });

    it('置き換える属性に $ が含まれても置換パターンとして解釈しない', () => {
      const svg = '<svg aria-label="$&" viewBox="0 0 1 2"></svg>';
      expect(withIntrinsicSize(svg)).toBe(
        '<svg width="1" height="2" aria-label="$&" viewBox="0 0 1 2"></svg>'
      );
    });
  });

  describe('異常系', () => {
    it('viewBox が無い・壊れている・大きさが 0 の SVG はそのまま返す', () => {
      const cases = [
        '<svg width="100%"></svg>',
        '<svg viewBox="0 0 abc 10"></svg>',
        '<svg viewBox="0 0 10"></svg>',
        '<svg viewBox="0 0 0 10"></svg>',
        'svg ではない文字列',
      ];
      for (const svg of cases) {
        expect(withIntrinsicSize(svg)).toBe(svg);
      }
    });
  });
});

describe('buildMermaidThemeVariables', () => {
  /** Nordic Frost の CSS 変数の値（`globals.css` の既定のテーマ） */
  const NORDIC: Record<string, string> = {
    '--color-nord-0': '#2e3440',
    '--color-nord-1': '#3b4252',
    '--color-nord-2': '#434c5e',
    '--color-nord-3': '#4c566a',
    '--color-nord-6': '#eceff4',
    '--color-nord-frost-1': '#88c0d0',
    '--color-nord-frost-2': '#81a1c1',
    '--color-nord-aurora-yellow': '#ebcb8b',
    '--color-nord-aurora-red': '#bf616a',
  };

  describe('正常系', () => {
    it('テーマの CSS 変数の値を mermaid の変数に対応させる', () => {
      const variables = buildMermaidThemeVariables((name) => NORDIC[name]);
      expect(variables).toEqual({
        background: '#2e3440',
        primaryColor: '#434c5e',
        primaryBorderColor: '#88c0d0',
        primaryTextColor: '#eceff4',
        textColor: '#eceff4',
        lineColor: '#81a1c1',
        secondaryColor: '#3b4252',
        tertiaryColor: '#4c566a',
        noteBkgColor: '#ebcb8b',
        noteTextColor: '#2e3440',
        errorBkgColor: '#bf616a',
      });
    });
  });

  describe('準正常系', () => {
    it('getPropertyValue が返す前後の空白を落とす', () => {
      const variables = buildMermaidThemeVariables(
        (name) => ` ${NORDIC[name]} `
      );
      expect(variables.background).toBe('#2e3440');
    });
  });

  describe('異常系', () => {
    it('未定義の変数（空文字）は入れず、mermaid の既定に任せる', () => {
      const variables = buildMermaidThemeVariables((name) =>
        name === '--color-nord-0' ? '#000000' : ''
      );
      expect(variables).toEqual({
        background: '#000000',
        noteTextColor: '#000000',
      });
    });
  });
});

describe('toPlantUmlDiagramState', () => {
  describe('正常系', () => {
    it('成功の svg を data: URI にする', () => {
      const svg = '<svg viewBox="0 0 1 1"><text>A</text></svg>';
      const state = toPlantUmlDiagramState(true, { svg });
      expect(state).toEqual({ status: 'rendered', src: svgToDataUri(svg) });
    });
  });

  describe('準正常系', () => {
    it('失敗の error をそのまま理由にする', () => {
      expect(
        toPlantUmlDiagramState(false, { error: 'Syntax Error?（2 行目）' })
      ).toEqual({ status: 'error', error: 'Syntax Error?（2 行目）' });
    });
  });

  describe('異常系', () => {
    it.each([
      ['JSON でない（null）', true, null],
      ['成功なのに svg が無い', true, {}],
      ['成功なのに svg が空', true, { svg: '' }],
      ['成功なのに svg が文字列でない', true, { svg: 1 }],
      ['失敗なのに error が無い', false, {}],
      ['失敗なのに error が文字列でない', false, { error: ['x'] }],
      ['失敗なのに svg がある', false, { svg: '<svg/>' }],
      ['配列', true, ['<svg/>']],
    ])('%sは想定外の応答として扱う', (_label, ok, json) => {
      expect(toPlantUmlDiagramState(ok, json)).toEqual({
        status: 'error',
        error: 'PlantUML の図を受け取れませんでした',
      });
    });
  });
});
