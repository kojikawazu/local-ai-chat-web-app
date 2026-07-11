import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import jsdoc from "eslint-plugin-jsdoc";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // JSDoc 規約（TSDoc スタイル）の機械的に判定できる部分を強制する。
  // 有効ルールの唯一の真実はこのブロック。方針の根拠は .claude/rules/jsdoc.md。
  // require-jsdoc は未採用のため、JSDoc を「持つ」関数の品質のみを検査する
  // （未文書化の関数を一斉にエラーにはしない = 段階導入向き）。
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { jsdoc },
    // TS 前提。型は JSDoc ではなくシグネチャに委ねる。
    settings: { jsdoc: { mode: "typescript" } },
    rules: {
      // 型の再掲を禁止（TS シグネチャが型の唯一の真実。jsdoc.md「型は書かない」）。
      "jsdoc/no-types": "error",
      // JSDoc ブロックを持つ関数は全引数を @param で説明する。
      // 分割代入 props は型（XxxProps）が真実なので props.x 単位には展開しない。
      "jsdoc/require-param": ["error", { checkDestructured: false, checkDestructuredRoots: false }],
      "jsdoc/require-param-description": "error",
      // @param 名と実引数名を突き合わせる（名前ズレ・順序・過不足を検出）。
      // 分割代入 props / options は型（XxxProps 等）が真実なので、ルート単位の
      // @param のみ要求し props.x 単位には展開しない（require-param と方針を揃える）。
      "jsdoc/check-param-names": ["error", { checkDestructured: false }],
      // 返り値がある関数は @returns に意味を書く（.tsx コンポーネントは後続ブロックで除外）。
      "jsdoc/require-returns": "error",
      "jsdoc/require-returns-description": "error",
      // 書いた JSDoc の体裁を整える。
      "jsdoc/check-alignment": "warn",
      "jsdoc/no-multi-asterisks": "warn",
    },
  },
  {
    // React コンポーネント（JSX を返す .tsx）は @returns を要求しない（「@returns …の要素」はノイズ）。
    // .ts のフック / lib / API では @returns 必須のまま。
    files: ["src/**/*.tsx"],
    rules: {
      "jsdoc/require-returns": "off",
      "jsdoc/require-returns-description": "off",
    },
  },
  // Prettier と競合する整形系ルールを無効化する。上のルールを上書きするため最後に置く。
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
