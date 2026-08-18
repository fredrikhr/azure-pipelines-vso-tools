/* eslint-disable n/no-unpublished-import */

import js from "@eslint/js";
import plgImport from "eslint-plugin-import";
import plgNode from "eslint-plugin-n";
import plgPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
// eslint-disable-next-line import/no-unresolved
import { defineConfig } from "eslint/config";

export default [
  plgImport.flatConfigs.recommended,
  plgNode.configs["flat/recommended"],
  ...defineConfig([
    {
      files: ["**/*.{js,mjs,cjs}"],
      plugins: { js },
      extends: ["js/recommended"],
      languageOptions: { globals: globals.node },
    },
  ]),
  plgPrettier,
];
