export const title = "Cheatsheet emphasis review";
export function state({ phase, pdf, checked, reviewed }) {
  if (phase === "Passed") {
    return reviewed === pdf ? "Review recorded" : "Older review recorded";
  }
  if (phase === "Frozen") return "PDF frozen";
  if (checked.length === 3) return "Draft checked";
  if (checked.length) return "Checks in progress";
  return "Draft needs checks";
}
export function step(action, from, to) {
  const inspected = to.checked.find((check) => !from.checked.includes(check));
  if (inspected) {
    return {
      sources: "check methods and priorities",
      color: "inspect color",
      grayscale: "inspect grayscale",
    }[inspected];
  }
  return {
    Revise: "edit and rebuild",
    Freeze: "freeze the PDF",
    Accept: "record review",
    Done: "finish",
  }[action];
}
