import { afterEach, describe, expect, it } from "vitest"
import * as React from "react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../src/index.js"
import { cleanup, click, getByText, renderUI } from "./helpers.js"

afterEach(cleanup)

function renderAccordion(type: "single" | "multiple") {
  return renderUI(
    <Accordion type={type} collapsible={type === "single" ? true : undefined}>
      <AccordionItem value="one">
        <AccordionTrigger>Item One</AccordionTrigger>
        <AccordionContent>Body One</AccordionContent>
      </AccordionItem>
      <AccordionItem value="two">
        <AccordionTrigger>Item Two</AccordionTrigger>
        <AccordionContent>Body Two</AccordionContent>
      </AccordionItem>
    </Accordion>,
  )
}

describe("Accordion", () => {
  it("single mode closes the previous item when another opens", () => {
    const { container } = renderAccordion("single")
    const triggerOne = getByText(container, "Item One")
    const triggerTwo = getByText(container, "Item Two")
    click(triggerOne)
    expect(triggerOne.getAttribute("data-state")).toBe("open")
    click(triggerTwo)
    expect(triggerTwo.getAttribute("data-state")).toBe("open")
    expect(triggerOne.getAttribute("data-state")).toBe("closed")
  })

  it("multiple mode keeps several items open and toggles closed again", () => {
    const { container } = renderAccordion("multiple")
    const triggerOne = getByText(container, "Item One")
    const triggerTwo = getByText(container, "Item Two")
    click(triggerOne)
    click(triggerTwo)
    expect(triggerOne.getAttribute("data-state")).toBe("open")
    expect(triggerTwo.getAttribute("data-state")).toBe("open")
    click(triggerOne)
    expect(triggerOne.getAttribute("data-state")).toBe("closed")
    expect(triggerTwo.getAttribute("data-state")).toBe("open")
    expect(container.textContent).toContain("Body Two")
  })
})
