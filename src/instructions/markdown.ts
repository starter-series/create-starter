/** Blank fenced examples while preserving source line numbers for every analyzer. */
export function stripFencedCode(text: string): string {
  let marker: string | undefined;
  return text.split(/\r?\n/u).map(line => {
    const fence = /^\s*(`{3,}|~{3,})(.*)$/u.exec(line);
    if (marker) {
      if (fence && fence[1][0] === marker[0] && fence[1].length >= marker.length && /^\s*$/u.test(fence[2])) marker = undefined;
      return "";
    }
    if (fence && !(fence[1][0] === "`" && fence[2].includes("`"))) {
      marker = fence[1];
      return "";
    }
    return line;
  }).join("\n");
}
