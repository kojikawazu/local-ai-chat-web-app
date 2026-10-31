import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';

// UI 部品（Atomic Design）の依存の向き（#163・docs/12-ui-components.md「依存の向き」）。
// 下の階層は上を import しない・共通の部品は機能の部品を import しない・機能の部品は他の機能を
// import しない。flat config では同じファイルに当たる設定の no-restricted-imports は後勝ちで
// 置き換わる（合成されない）ため、ディレクトリの組み合わせごとに禁止を全部まとめて 1 つの設定にする。
const UI_FEATURES = [
  'chat',
  'sidebar',
  'settings',
  'prompt-template',
  'bookmark',
  'shortcut',
];

/** 自分より上の階層（相対・エイリアスどちらの import も、パスの途中の階層名で判定する） */
const ABOVE = {
  atoms: '(^|/)(molecules|organisms|templates)/',
  molecules: '(^|/)(organisms|templates)/',
  organisms: '(^|/)templates/',
};

/**
 * no-restricted-imports の設定を作る。
 *
 * @param files - 対象のファイル
 * @param patterns - 禁止する import の正規表現と、その理由
 * @returns flat config の 1 要素
 */
function restrictImports(files, patterns) {
  return {
    files,
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: patterns.map(([regex, message]) => ({ regex, message })) },
      ],
    },
  };
}

const NO_UPPER_LAYER =
  '下の階層から上の階層は import しない（atoms ← molecules ← organisms ← page。templates は page だけが使う）';
const NO_FEATURE_FROM_COMMON =
  '共通の部品（components/common）は機能の部品・機能のフックを import しない';
const NO_OTHER_FEATURE =
  '機能の部品は他の機能の部品を import しない。機能をまたいで使うものは components/common へ移す';

const atomicDesignRules = [
  ...['atoms', 'molecules'].map((layer) =>
    restrictImports(
      [`src/components/common/${layer}/**/*.{ts,tsx}`],
      [
        [ABOVE[layer], NO_UPPER_LAYER],
        ['^@/components/features/', NO_FEATURE_FROM_COMMON],
        [`^@/hooks/(${UI_FEATURES.join('|')})/`, NO_FEATURE_FROM_COMMON],
      ]
    )
  ),
  restrictImports(
    ['src/components/common/templates/**/*.{ts,tsx}'],
    [
      ['(^|/)organisms/', NO_UPPER_LAYER],
      ['^@/components/features/', NO_FEATURE_FROM_COMMON],
      [`^@/hooks/(${UI_FEATURES.join('|')})/`, NO_FEATURE_FROM_COMMON],
    ]
  ),
  ...UI_FEATURES.flatMap((feature) => [
    ...['atoms', 'molecules', 'organisms'].map((layer) =>
      restrictImports(
        [`src/components/features/${feature}/${layer}/**/*.{ts,tsx}`],
        [
          [ABOVE[layer], NO_UPPER_LAYER],
          [`^@/components/features/(?!${feature}/)`, NO_OTHER_FEATURE],
        ]
      )
    ),
  ]),
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // JSDoc 規約（TSDoc スタイル）の機械的に判定できる部分を強制する。
  // 有効ルールの唯一の真実はこのブロック。方針の根拠は .claude/rules/jsdoc.md。
  // require-jsdoc は未採用のため、JSDoc を「持つ」関数の品質のみを検査する
  // （未文書化の関数を一斉にエラーにはしない = 段階導入向き）。
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { jsdoc },
    // TS 前提。型は JSDoc ではなくシグネチャに委ねる。
    settings: { jsdoc: { mode: 'typescript' } },
    rules: {
      // 型の再掲を禁止（TS シグネチャが型の唯一の真実。jsdoc.md「型は書かない」）。
      'jsdoc/no-types': 'error',
      // JSDoc ブロックを持つ関数は全引数を @param で説明する。
      // 分割代入 props は型（XxxProps）が真実なので props.x 単位には展開しない。
      'jsdoc/require-param': [
        'error',
        { checkDestructured: false, checkDestructuredRoots: false },
      ],
      'jsdoc/require-param-description': 'error',
      // @param 名と実引数名を突き合わせる（名前ズレ・順序・過不足を検出）。
      // 分割代入 props / options は型（XxxProps 等）が真実なので、ルート単位の
      // @param のみ要求し props.x 単位には展開しない（require-param と方針を揃える）。
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      // 返り値がある関数は @returns に意味を書く（.tsx コンポーネントは後続ブロックで除外）。
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
      // 書いた JSDoc の体裁を整える。
      'jsdoc/check-alignment': 'warn',
      'jsdoc/no-multi-asterisks': 'warn',
    },
  },
  // 型のみの import を `import type` に強制する（.claude/rules/typescript.md「import type 強制」）。
  // src だけでなく tests も対象にする（テストでも型と値を混ぜない方針を揃える）。
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      // fixStyle は separate-type-imports。typescript.md が「値と型を混ぜない」と
      // 定めているため、混在 import は inline（`import { type X, y }`）ではなく
      // `import type { X }` + `import { y }` の 2 文に分離する。
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    // React コンポーネント（JSX を返す .tsx）は @returns を要求しない（「@returns …の要素」はノイズ）。
    // .ts のフック / lib / API では @returns 必須のまま。
    files: ['src/**/*.tsx'],
    rules: {
      'jsdoc/require-returns': 'off',
      'jsdoc/require-returns-description': 'off',
    },
  },
  ...atomicDesignRules,
  // Prettier と競合する整形系ルールを無効化する。上のルールを上書きするため最後に置く。
  prettier,
  // `.prettierignore` の除外のうち、JS/TS を含みうる生成物・テスト成果物は ESLint でも除外する
  // （画像・ロックファイル等の ESLint が元々対象にしないものは載せない）。
  // 特に E2E の HTML レポートは trace/ に JS を同梱し、lint 結果を数千件のノイズで埋めるため除外必須。
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'src/generated/**',
    'playwright-report/**',
    'test-results/**',
    'blob-report/**',
  ]),
]);

export default eslintConfig;
