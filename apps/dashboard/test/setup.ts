import "@testing-library/jest-dom/vitest";
import { setLocale } from "@max/i18n";

// Default test locale is en-US so existing English assertions keep working
// without per-test boilerplate. The i18n package defaults to zh-CN by design
// (project requirement) — tests that want to exercise Chinese can call
// setLocale("zh-CN") inside their own setup.
setLocale("en-US");
