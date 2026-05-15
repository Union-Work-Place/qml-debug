import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import typescriptParser from "@typescript-eslint/parser";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default [
    {
        ignores: [
            "coverage/**",
            "dist/**",
            "node_modules/**",
            "out/**",
            "out-test/**",
            "test/qt-fixture/build/**"
        ]
    },
    {
        files: [ "src/**/*.ts" ],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: dirname,
                ecmaVersion: 2022,
                sourceType: "module"
            },
            globals: {
                ...globals.node,
                ...globals.es2022
            }
        },
        plugins: {
            "@typescript-eslint": typescriptPlugin
        },
        rules: {
            ...js.configs.recommended.rules,
            ...typescriptPlugin.configs.recommended.rules,
            "curly": [ "warn", "multi-or-nest", "consistent" ],
            "eqeqeq": "warn",
            "no-constant-condition": [ "error", { "checkLoops": false } ],
            "no-empty": "off",
            "no-labels": "error",
            "no-throw-literal": "warn",
            "no-unused-vars": "off",
            "prefer-const": "warn",
            "semi": [ "error", "always" ],

            "@typescript-eslint/array-type": [ "error", { "default": "array", "readonly": "array" } ],
            "@typescript-eslint/await-thenable": "error",
            "@typescript-eslint/consistent-indexed-object-style": [ "error", "index-signature" ],
            "@typescript-eslint/consistent-type-definitions": [ "error", "interface" ],
            "@typescript-eslint/consistent-type-imports": [ "error", { "prefer": "no-type-imports" } ],
            "@typescript-eslint/explicit-member-accessibility": "error",
            "@typescript-eslint/explicit-module-boundary-types": [ "error", { "allowArgumentsExplicitlyTypedAsAny": true } ],
            "@typescript-eslint/method-signature-style": [ "error", "method" ],
            "@typescript-eslint/no-base-to-string": "error",
            "@typescript-eslint/no-confusing-non-null-assertion": "error",
            "@typescript-eslint/no-confusing-void-expression": "error",
            "@typescript-eslint/no-empty-function": "error",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/no-unused-vars": [ "error", { "args": "none", "caughtErrorsIgnorePattern": "^ignore" } ],
            "@typescript-eslint/naming-convention": [
                "warn",
                {
                    "selector": [ "class", "interface", "typeAlias", "enum", "typeParameter" ],
                    "format": [ "PascalCase" ],
                    "leadingUnderscore": "forbid",
                    "trailingUnderscore": "forbid"
                },
                {
                    "selector": [ "function", "classProperty", "objectLiteralProperty", "typeProperty", "classMethod", "objectLiteralMethod", "typeMethod", "accessor" ],
                    "format": [ "camelCase" ],
                    "leadingUnderscore": "forbid",
                    "trailingUnderscore": "allow"
                },
                {
                    "selector": [ "enumMember" ],
                    "format": [ "PascalCase" ],
                    "leadingUnderscore": "forbid",
                    "trailingUnderscore": "forbid"
                },
                {
                    "selector": [ "variable" ],
                    "format": [ "camelCase" ],
                    "leadingUnderscore": "allow",
                    "trailingUnderscore": "forbid"
                }
            ]
        }
    }
];