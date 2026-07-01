/**
 * Phase 9 — Frontend Benchmark Tasks.
 *
 * 3 high-difficulty frontend tasks testing:
 *   1. Dynamic multi-step form state machine
 *   2. Virtualized infinite scroll with performance constraints
 *   3. Custom reactive hook with side-effects management
 *
 * Each task requires structural code validation (no runtime rendering).
 */

import type { BenchmarkTask, FrontendTaskContext } from "../../packages/benchmark-core/src/types.js";

// ── Task 1: Multi-Step Form State Machine ───────────────────────────────────

const task1Context: FrontendTaskContext = {
  componentType: "react",
  requirements: [
    "Must implement a multi-step form with at least 3 steps",
    "Must use useState for current step tracking",
    "Must support forward and backward navigation",
    "Must validate each step before allowing progression",
    "Must collect and merge data from all steps into a final submission object",
    "Must render different form fields based on the current step",
  ],
  structuralQueries: [
    { pattern: "useState.*step|step.*useState", required: true, label: "Tracks current step with useState" },
    { pattern: "currentStep|activeStep|stepIndex", required: true, label: "Has a step index variable" },
    { pattern: "next|forward|proceed|handleNext", required: true, label: "Has forward navigation" },
    { pattern: "prev|back|handleBack|goBack", required: true, label: "Has backward navigation" },
    { pattern: "valid|error|validation|isValid", required: true, label: "Has validation logic" },
    { pattern: "onSubmit|handleSubmit|submit", required: true, label: "Has submit handler" },
    { pattern: "formData|formState|values|fields", required: false, label: "Tracks form data" },
    { pattern: "step ===|step ===|currentStep ===|case", required: false, label: "Conditional step rendering" },
  ],
};

// ── Task 2: Virtualized Infinite Scroll ─────────────────────────────────────

const task2Context: FrontendTaskContext = {
  componentType: "react",
  requirements: [
    "Must implement an infinite scroll list component",
    "Must use useEffect for scroll event handling or IntersectionObserver",
    "Must only render visible items (virtualization)",
    "Must handle loading states",
    "Must support dynamic item heights or fixed row heights",
    "Must not re-render the entire list on scroll",
  ],
  structuralQueries: [
    { pattern: "useEffect.*scroll|IntersectionObserver|onScroll", required: true, label: "Has scroll handling" },
    { pattern: "scrollTop|getBoundingClientRect|offsetHeight|innerHeight", required: true, label: "Measures scroll position" },
    { pattern: "loading|isLoading|setLoading", required: true, label: "Has loading state" },
    { pattern: "slice|renderItems|visibleItems|startIndex|endIndex", required: false, label: "Virtualizes visible items" },
    { pattern: "useCallback|useMemo|React\\.memo", required: false, label: "Has performance optimizations" },
    { pattern: "containerRef|listRef|scrollRef|useRef", required: false, label: "Uses refs for DOM measurement" },
  ],
};

// ── Task 3: Custom Reactive Hook ────────────────────────────────────────────

const task3Context: FrontendTaskContext = {
  componentType: "react",
  requirements: [
    "Must implement a custom hook (useXxx pattern)",
    "Must use useEffect for side effect management",
    "Must use cleanup function in useEffect (return () => ...)",
    "Must handle error states",
    "Must support dependency array for effect triggering",
    "Must return a typed interface (value, loading, error, refetch)",
  ],
  structuralQueries: [
    { pattern: "export\\s+(default\\s+)?function\\s+use[A-Z]|const\\s+use[A-Z].*=.*\\(", required: true, label: "Is a custom hook (useXxx)" },
    { pattern: "useEffect\\s*\\(", required: true, label: "Uses useEffect" },
    { pattern: "return\\s+\\(\\s*\\)|return\\s+()=>|cleanup|unmount", required: true, label: "Has cleanup function" },
    { pattern: "catch|error|isError|setError", required: true, label: "Handles errors" },
    { pattern: "\\[.*\\].*useEffect|useEffect.*\\[", required: true, label: "Has dependency array" },
    { pattern: "return\\s*\\{|return\\s*\\(", required: true, label: "Returns an object or value" },
    { pattern: "useState|useReducer|useRef", required: false, label: "Uses internal state management" },
  ],
};

// ── Assertion Functions ──────────────────────────────────────────────────────

async function assertFormStateMachine(output: string): Promise<boolean> {
  return /step|form|state/i.test(output);
}

async function assertInfiniteScroll(output: string): Promise<boolean> {
  return /scroll|list|virtual/i.test(output);
}

async function assertCustomHook(output: string): Promise<boolean> {
  return /use[A-Z]|hook|effect/i.test(output);
}

// ── Exported Tasks ───────────────────────────────────────────────────────────

export const FRONTEND_TASKS: BenchmarkTask[] = [
  {
    id: "frontend-form-state-machine",
    domain: "frontend",
    difficulty: "hard",
    input:
      "Create a React component called `MultiStepForm` that implements a 3-step form wizard:\n\n" +
      "Step 1: Personal Info (name, email)\n" +
      "Step 2: Address (street, city, zip)\n" +
      "Step 3: Preferences (newsletter opt-in, theme selection)\n\n" +
      "Requirements:\n" +
      "- Track current step with state\n" +
      "- Validate each step before allowing 'Next'\n" +
      "- Show validation errors inline\n" +
      "- Allow going back to previous steps\n" +
      "- On final submit, merge all step data and call an onSubmit callback\n" +
      "- Render step indicator (e.g. 'Step 2 of 3')",
    context: task1Context as unknown as Record<string, unknown>,
    expectedOutputAssertion: assertFormStateMachine,
  },
  {
    id: "frontend-virtualized-scroll",
    domain: "frontend",
    difficulty: "hard",
    input:
      "Create a React component called `VirtualList` that renders a list of 10,000+ items efficiently:\n\n" +
      "Requirements:\n" +
      "- Only render items visible in the viewport + a small buffer\n" +
      "- Use scroll position to determine which items to render\n" +
      "- Show a loading spinner when fetching more data\n" +
      "- Support a `loadMore` callback when the user scrolls near the bottom\n" +
      "- Each item has a fixed height of 50px\n" +
      "- Container has a fixed height of 400px\n" +
      "- Use refs for DOM measurement, not querySelector",
    context: task2Context as unknown as Record<string, unknown>,
    expectedOutputAssertion: assertInfiniteScroll,
  },
  {
    id: "frontend-custom-hook",
    domain: "frontend",
    difficulty: "hard",
    input:
      "Create a custom React hook called `useFetch` that manages async data fetching:\n\n" +
      "Requirements:\n" +
      "- Accept a URL string and optional fetch options\n" +
      "- Return { data, loading, error, refetch }\n" +
      "- Use useEffect to trigger the fetch when the URL changes\n" +
      "- Implement proper cleanup (abort controller) to prevent state updates on unmounted components\n" +
      "- Handle network errors and non-2xx HTTP responses\n" +
      "- Support a `refetch` function to manually re-trigger the fetch\n" +
      "- Use TypeScript generics for the return type: useFetch<T>(url)",
    context: task3Context as unknown as Record<string, unknown>,
    expectedOutputAssertion: assertCustomHook,
  },
];
