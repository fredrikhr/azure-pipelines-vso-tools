import js from "@eslint/js";
import plgImport from "eslint-plugin-import";
import plgNode from "eslint-plugin-n";
import plgPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default /** @type {import("eslint").Linter.Config} */ ([
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
]);
