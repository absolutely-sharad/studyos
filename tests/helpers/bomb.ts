import { deflateSync } from "node:zlib";

/** A PDF whose single Flate-compressed content stream inflates to `megabytes` of operators: tiny on disk, huge in memory. */
export function pdfBomb(megabytes: number): Buffer {
  const unit = Buffer.from("q Q ");
  const raw = Buffer.alloc(megabytes * 1024 * 1024);
  for (let i = 0; i < raw.length; i += unit.length) unit.copy(raw, i, 0, Math.min(unit.length, raw.length - i));
  const z = deflateSync(raw, { level: 9 });
  const objects: Buffer[] = [];
  objects[1] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects[3] = Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>");
  objects[4] = Buffer.concat([Buffer.from(`<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`), z, Buffer.from("\nendstream")]);
  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let position = parts[0].length;
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = position;
    const chunk = Buffer.concat([Buffer.from(`${id} 0 obj\n`), objects[id], Buffer.from("\nendobj\n")]);
    parts.push(chunk);
    position += chunk.length;
  }
  let tail = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) tail += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  tail += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`;
  parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}
