import wordmark from "../assets/brand/kadwood-wordmark.svg?raw";
import iconUrl from "../assets/brand/lilo-icon.svg";

/** The Lilo app icon: the black hibiscus on cream, as a small rounded tile (the title strip). */
export function BrandMark({ size = 24 }: { size?: number }) {
  return <img className="brand-mark" src={iconUrl} width={size} height={size} alt="" draggable={false} />;
}

/**
 * The Kadwood wordmark, inline so it takes the text colour (black on light, cream on dark). The SVG is
 * one of our own assets, bundled at build time.
 */
export function KadwoodWordmark({ height = 16 }: { height?: number }) {
  return <span className="kadwood-wordmark" role="img" aria-label="Kadwood" style={{ height }} dangerouslySetInnerHTML={{ __html: wordmark.replace(' role="img" aria-label="Kadwood"', ' aria-hidden="true" focusable="false"') }} />;
}
