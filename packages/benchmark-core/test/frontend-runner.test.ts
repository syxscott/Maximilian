/**
 * Phase 9 — Frontend Runner tests.
 *
 * Tests regex-based structural validation of React component code.
 * No runtime rendering — pure code analysis.
 */

import { describe, it, expect } from "vitest";
import { FrontendRunner } from "../src/runners/frontend-runner.js";
import type { FrontendTaskContext } from "../src/types.js";

describe("FrontendRunner", () => {
  const runner = new FrontendRunner();

  const reactContext: FrontendTaskContext = {
    componentType: "react",
    requirements: ["Must use useState", "Must have event handler"],
    structuralQueries: [
      { pattern: "useState\\s*\\(", required: true, label: "Uses useState" },
      { pattern: "onClick|onChange|onSubmit", required: true, label: "Has event handler" },
      { pattern: "useEffect\\s*\\(", required: false, label: "Uses useEffect" },
    ],
  };

  it("validates a correct React component", () => {
    const code = `
      export default function Counter() {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
      }
    `;
    const result = runner.validateComponent(code, reactContext);
    expect(result.syntaxValid).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.quality).toBeGreaterThan(0.5);
  });

  it("fails when required pattern is missing", () => {
    const code = `
      export default function Display({ value }: { value: string }) {
        return <div>{value}</div>;
      }
    `;
    const result = runner.validateComponent(code, reactContext);
    expect(result.passed).toBe(false);
    const useStateFinding = result.structuralFindings.find((f) => f.label === "Uses useState");
    expect(useStateFinding?.found).toBe(false);
  });

  it("passes when optional pattern is missing", () => {
    const code = `
      export default function Counter() {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
      }
    `;
    const result = runner.validateComponent(code, reactContext);
    expect(result.passed).toBe(true);
    const useEffectFinding = result.structuralFindings.find((f) => f.label === "Uses useEffect");
    expect(useEffectFinding?.found).toBe(false);
  });

  it("fails on unbalanced braces", () => {
    const code = `
      export default function Bad() {
        const [x, setX] = useState(0);
        return <div>{x}</div>;
      // missing closing brace
    `;
    const result = runner.validateComponent(code, reactContext);
    expect(result.syntaxValid).toBe(false);
    expect(result.quality).toBe(0);
  });

  it("fails on unbalanced parentheses", () => {
    const code = `
      export default function Bad() {
        const [x, setX] = useState(0;
        return <div>{x}</div>;
      }
    `;
    const result = runner.validateComponent(code, reactContext);
    expect(result.syntaxValid).toBe(false);
  });

  it("fails when missing export", () => {
    const code = `
      function Counter() {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
      }
    `;
    const result = runner.validateComponent(code, reactContext);
    expect(result.syntaxValid).toBe(false);
  });

  it("detects semantic HTML elements", () => {
    const code = `
      export default function Page() {
        const [x, setX] = useState(0);
        return (
          <main>
            <nav><button onClick={() => setX(1)}>Go</button></nav>
          </main>
        );
      }
    `;
    const result = runner.validateComponent(code, reactContext);
    const semanticFinding = result.structuralFindings.find((f) => f.label === "Uses semantic HTML elements");
    expect(semanticFinding?.found).toBe(true);
  });

  it("detects aria attributes", () => {
    const code = `
      export default function Accessible() {
        const [open, setOpen] = useState(false);
        return <button onClick={() => setOpen(!open)} aria-expanded={open}>Toggle</button>;
      }
    `;
    const result = runner.validateComponent(code, reactContext);
    const ariaFinding = result.structuralFindings.find((f) => f.label === "Has accessibility attributes (aria-* or role)");
    expect(ariaFinding?.found).toBe(true);
  });

  it("handles string with braces correctly", () => {
    const code = `
      export default function Template() {
        const [x, setX] = useState("{not a brace}");
        return <button onClick={() => setX("}")}>{x}</button>;
      }
    `;
    const result = runner.validateComponent(code, reactContext);
    expect(result.syntaxValid).toBe(true);
  });

  it("computes quality as weighted score", () => {
    const code = `
      export default function Full() {
        const [x, setX] = useState(0);
        return <button onClick={() => setX(1)}>{x}</button>;
      }
    `;
    const result = runner.validateComponent(code, reactContext);
    // Required: 2/2 found (useState, onClick)
    // Optional queries: 0/1 (useEffect missing)
    // Built-in optional: useState(found), useEffect(not), semantic(not), aria(not), event(found), key(not)
    // Total optional: 2/7
    // quality = 0.7 * (2/2) + 0.3 * (2/7) ≈ 0.79
    expect(result.quality).toBeGreaterThan(0.7);
    expect(result.quality).toBeLessThan(1);
    expect(result.passed).toBe(true); // all required found
  });

  it("returns quality=1 when all patterns found including built-ins", () => {
    const code = `
      export default function Full() {
        const [x, setX] = useState(0);
        useEffect(() => {}, []);
        return (
          <main>
            <button onClick={() => setX(1)} aria-label="inc" key="btn">{x}</button>
          </main>
        );
      }
    `;
    const result = runner.validateComponent(code, reactContext);
    // Required: 2/2, Optional queries: 1/1
    // Built-in: useState(found), useEffect(found), semantic(found), aria(found), event(found), key(found)
    // Total optional: 7/7
    // quality = 0.7 * 1.0 + 0.3 * 1.0 = 1.0
    expect(result.quality).toBe(1);
    expect(result.passed).toBe(true);
  });
});
