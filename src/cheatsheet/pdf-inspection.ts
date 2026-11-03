import type { CheatsheetConstraints } from "./types.js";

export const fontMeasurementZoom = 3;
export const fontMeasurementTolerance = 0.2;

function attribute(attributes: string, name: string): number {
  const value = Number(
    new RegExp(`\\b${name}="(-?[0-9.]+)"`, "u").exec(attributes)?.[1],
  );
  if (!Number.isFinite(value)) throw new Error(`PDF XML lacks finite ${name}.`);
  return value / fontMeasurementZoom;
}

export function inspectPdfBoundaries(
  xml: string,
  layout?: CheatsheetConstraints["layout"],
): { pages: number; textBoxes: number; furnitureChecked: boolean } {
  let pages = 0;
  let textBoxes = 0;
  const mm = 72 / 25.4;
  const tolerance = 0.5;
  for (const match of xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/gu)) {
    pages += 1;
    const width = attribute(match[1] ?? "", "width");
    const height = attribute(match[1] ?? "", "height");
    for (const text of (match[2] ?? "").matchAll(
      /<text\b([^>]*)>([\s\S]*?)<\/text>/gu,
    )) {
      if (visibleCharacterCount(text[2] ?? "") === 0) continue;
      textBoxes += 1;
      const attributes = text[1] ?? "";
      const left = attribute(attributes, "left");
      const top = attribute(attributes, "top");
      const right = left + attribute(attributes, "width");
      const bottom = top + attribute(attributes, "height");
      if (
        left < -tolerance ||
        top < -tolerance ||
        right > width + tolerance ||
        bottom > height + tolerance
      )
        throw new Error(
          `Off-page PDF text on page ${pages}: ${[left, top, right, bottom].join(",")}.`,
        );
      if (layout === undefined) continue;
      const headerBottom = layout.headerBottomMm * mm;
      const footerTop = layout.footerTopMm * mm;
      if (
        (top < headerBottom - tolerance && bottom > headerBottom + tolerance) ||
        (top < footerTop - tolerance && bottom > footerTop + tolerance)
      )
        throw new Error(
          `PDF text crosses a header/footer clearance on page ${pages}.`,
        );
      if (
        top >= headerBottom - tolerance &&
        bottom <= footerTop + tolerance &&
        (left < layout.marginsMm.left * mm - tolerance ||
          right > width - layout.marginsMm.right * mm + tolerance ||
          top < layout.marginsMm.top * mm - tolerance ||
          bottom > height - layout.marginsMm.bottom * mm + tolerance)
      )
        throw new Error(
          `PDF body text crosses its declared boundary on page ${pages}.`,
        );
    }
  }
  if (pages === 0 || textBoxes === 0)
    throw new Error("PDF XML contains no inspectable pages/text.");
  return { pages, textBoxes, furnitureChecked: layout !== undefined };
}

function visibleCharacterCount(xmlText: string): number {
  return xmlText
    .replace(/<[^>]+>/gu, "")
    .replace(/&(?:#x?[0-9A-Fa-f]+|[A-Za-z]+);/gu, "x")
    .replace(/\s/gu, "").length;
}

export function dominantBodyPointSize(xml: string): number {
  const weights = new Map<number, number>();
  const pages = xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/gu);
  for (const pageMatch of pages) {
    const page = pageMatch[1] ?? "";
    const sizes = new Map<string, number>();
    for (const font of page.matchAll(/<fontspec\b([^>]*)\/>/gu)) {
      const attributes = font[1] ?? "";
      const id = /\bid="([^"]+)"/u.exec(attributes)?.[1];
      const scaledSize = Number(/\bsize="([0-9.]+)"/u.exec(attributes)?.[1]);
      if (id !== undefined && Number.isFinite(scaledSize)) {
        sizes.set(id, scaledSize / fontMeasurementZoom);
      }
    }
    for (const text of page.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gu)) {
      const id = /\bfont="([^"]+)"/u.exec(text[1] ?? "")?.[1];
      const size = id === undefined ? undefined : sizes.get(id);
      const weight = visibleCharacterCount(text[2] ?? "");
      if (size !== undefined && weight > 0) {
        weights.set(size, (weights.get(size) ?? 0) + weight);
      }
    }
  }
  const bodySize = [...weights]
    .sort(
      ([leftSize, leftWeight], [rightSize, rightWeight]) =>
        rightWeight - leftWeight || leftSize - rightSize,
    )
    .at(0)?.[0];
  if (bodySize === undefined) {
    throw new Error("PDF font inspection found no visible text.");
  }
  return bodySize;
}
