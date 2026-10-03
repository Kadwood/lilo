/** The engine (stitchjs + WASM geometry) is heavy; load it only when Export/Send is used. */
export async function loadDemoPes(): Promise<Uint8Array> {
  const { demoSatinPes } = await import("@lilo/engine");
  return demoSatinPes();
}
