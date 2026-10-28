import { crc32, deflateRawSync } from "node:zlib";
import { open } from "node:fs/promises";

// A minimal ZIP writer (deflate, no ZIP64) for the PNG frame sequence, plus a
// reader of its central directory so an archive is verified before it is
// offered. Entry names come from the exporter, never from user input.

export type ZipEntry = { readonly name: string; readonly data: Buffer };

const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // fixed: deterministic archives
const DOS_TIME = 0;

export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!/^[\w.-]{1,80}$/.test(entry.name)) throw new Error(`invalid zip entry name ${entry.name}`);
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 6 });
    const checksum = crc32(entry.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Entry names and sizes from the central directory. Throws on a malformed archive. */
export function listZip(archive: Buffer): { name: string; size: number }[] {
  const endAt = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error("zip: no end of central directory");
  const count = archive.readUInt16LE(endAt + 10);
  let at = archive.readUInt32LE(endAt + 16);
  const entries: { name: string; size: number }[] = [];
  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error("zip: bad central directory entry");
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extra = archive.readUInt16LE(at + 30);
    const comment = archive.readUInt16LE(at + 32);
    entries.push({ name: archive.subarray(at + 46, at + 46 + nameLength).toString("utf8"), size });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

/** Writes one entry at a time; only the small central directory stays in memory. */
export async function writeZipFile(file: string, entries: AsyncIterable<ZipEntry>): Promise<{ name: string; size: number }[]> {
  const output = await open(file, "w");
  const central: Buffer[] = [];
  const listed: { name: string; size: number }[] = [];
  let offset = 0;
  try {
    for await (const entry of entries) {
      const single = writeZip([entry]);
      const at = single.readUInt32LE(single.length - 6);
      const directory = Buffer.from(single.subarray(at, single.length - 22));
      directory.writeUInt32LE(offset, 42);
      await output.writeFile(single.subarray(0, at));
      offset += at;
      if (offset > 0xffffffff) throw new Error("Frame archive exceeds ZIP32 size");
      central.push(directory);
      listed.push({ name: entry.name, size: entry.data.length });
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(listed.length, 8);
    end.writeUInt16LE(listed.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    await output.writeFile(directory);
    await output.writeFile(end);
    return listed;
  } finally { await output.close(); }
}

/** Verify a streamed ZIP using only its bounded directory, never its image payloads. */
export async function listZipFile(file: string): Promise<{ name: string; size: number }[]> {
  const input = await open(file, "r");
  try {
    const size = (await input.stat()).size;
    if (size < 22) throw new Error("zip: missing end record");
    const end = Buffer.alloc(22);
    if ((await input.read(end, 0, 22, size - 22)).bytesRead !== 22 || end.readUInt32LE(0) !== 0x06054b50) throw new Error("zip: invalid end record");
    const length = end.readUInt32LE(12), offset = end.readUInt32LE(16);
    if (length > 10 * 1024 * 1024 || offset + length !== size - 22) throw new Error("zip: invalid directory bounds");
    const directory = Buffer.alloc(length);
    if ((await input.read(directory, 0, length, offset)).bytesRead !== length) throw new Error("zip: incomplete directory");
    end.writeUInt32LE(0, 16);
    return listZip(Buffer.concat([directory, end]));
  } finally { await input.close(); }
}
