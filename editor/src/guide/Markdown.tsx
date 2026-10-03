import { Fragment, type ReactNode } from "react";
import { diagramUrl } from "./data";

/**
 * A small, safe Markdown renderer for the guide. It builds React elements only (no innerHTML), so a page
 * can never inject markup. It understands what the pages use: headings, paragraphs, bullet and numbered
 * lists, tables, images, **bold**, *italic*, `code` and links. Raw HTML in a page is shown as plain text.
 *
 * Links: `page.md#heading` opens that guide page in place; `https://` links go to `onExternal` (the host
 * decides how to open them); anything else is shown as text.
 */

export interface MarkdownProps {
  source: string;
  /** A guide link was followed: `id` or `id#heading`. */
  onNavigate: (ref: string) => void;
  onExternal?: (url: string) => void;
}

export const headingSlug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/`|\*|_/g, "")
    .replace(/[^a-z0-9 \-]/g, "")
    .trim()
    .replace(/ +/g, "-");

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "image"; alt: string; src: string }
  | { kind: "code"; text: string };

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

export function parseBlocks(source: string): Block[] {
  const lines = source.split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (h) {
      out.push({ kind: "heading", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    if (img) {
      out.push({ kind: "image", alt: img[1], src: img[2] });
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i++]));
      out.push({ kind: "table", head, rows });
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m && /\d/.test(m[2]) === ordered) {
          items.push(m[3]);
          i++;
        } else if (m === null && /^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1] += ` ${lines[i].trim()}`; // a wrapped item
          i++;
        } else break;
      }
      out.push({ kind: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\|)/.test(lines[i]) && !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i]) && !/^!\[/.test(lines[i])) para.push(lines[i++].trim());
    out.push({ kind: "para", text: para.join(" ") });
  }
  return out;
}

const INLINE = /(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*\s][^*]*)\*)/;

function Image({ alt, src }: { alt: string; src: string }) {
  const url = src.startsWith("diagrams/") ? diagramUrl(src) : undefined;
  if (url) return <img className="guide-diagram" src={url} alt={alt} loading="lazy" />;
  return (
    <span className="guide-shot" role="img" aria-label={`${alt} (screenshot not captured yet)`}>
      <span aria-hidden="true">{alt}</span>
    </span>
  );
}

function Inline({ text, props }: { text: string; props: MarkdownProps }): ReactNode {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      nodes.push(rest);
      break;
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    if (m[1]) nodes.push(<Image key={key++} alt={m[2]} src={m[3]} />);
    else if (m[4]) nodes.push(<Link key={key++} text={m[5]} href={m[6]} props={props} />);
    else if (m[7]) nodes.push(<strong key={key++}>{m[8]}</strong>);
    else if (m[9]) nodes.push(<code key={key++}>{m[10]}</code>);
    else if (m[11]) nodes.push(<em key={key++}>{m[12]}</em>);
    rest = rest.slice(m.index + m[0].length);
  }
  return <>{nodes}</>;
}

function Link({ text, href, props }: { text: string; href: string; props: MarkdownProps }) {
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} rel="noreferrer noopener" onClick={(e) => (e.preventDefault(), props.onExternal?.(href))}>
        {text}
        <span className="sr-only"> (opens in your browser)</span>
      </a>
    );
  }
  if (/\.md(#|$)/.test(href) && !href.startsWith("../")) {
    const ref = href.replace(/\.md/, "");
    return (
      <a href={`#help/${ref}`} onClick={(e) => (e.preventDefault(), props.onNavigate(ref))}>
        {text}
      </a>
    );
  }
  return <>{text}</>;
}

export function Markdown(props: MarkdownProps) {
  const blocks = parseBlocks(props.source);
  const inline = (t: string) => <Inline text={t} props={props} />;
  return (
    <div className="guide-md">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading": {
            const Tag = `h${Math.min(4, b.level + 1)}` as "h2" | "h3" | "h4" | "h5"; // the page title (#) is the panel's h2 area; shift everything down one
            return (
              <Tag key={i} id={`h-${headingSlug(b.text)}`} data-slug={headingSlug(b.text)}>
                {inline(b.text)}
              </Tag>
            );
          }
          case "para":
            return <p key={i}>{inline(b.text)}</p>;
          case "list": {
            const L = b.ordered ? "ol" : "ul";
            return (
              <L key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </L>
            );
          }
          case "table":
            return (
              <div className="guide-table" key={i} role="region" tabIndex={0} aria-label="Table">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} scope="col">
                          {inline(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <Fragment key={k}>{k === 0 ? <th scope="row">{inline(c)}</th> : <td>{inline(c)}</td>}</Fragment>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "image":
            return (
              <figure key={i}>
                <Image alt={b.alt} src={b.src} />
              </figure>
            );
          case "code":
            return (
              <pre key={i}>
                <code>{b.text}</code>
              </pre>
            );
        }
      })}
    </div>
  );
}
