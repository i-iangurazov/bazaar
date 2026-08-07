import { open, type FileHandle } from "node:fs/promises";

type CentralDirectoryEntry = {
  name: Buffer;
  crc32: number;
  size: number;
  offset: number;
  dosDate: number;
  dosTime: number;
};

const utf8Flag = 0x0800;
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = (data: Buffer) => {
  let value = 0xffffffff;
  for (const byte of data) {
    value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const toDosDateTime = (date: Date) => {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

export class ImageExportZipWriter {
  private handle: FileHandle | null = null;
  private offset = 0;
  private entries: CentralDirectoryEntry[] = [];

  constructor(
    private readonly path: string,
    private readonly maxBytes: number,
  ) {}

  private async getHandle() {
    this.handle ??= await open(this.path, "wx");
    return this.handle;
  }

  private async write(buffer: Buffer) {
    if (this.offset + buffer.length > this.maxBytes) {
      throw new Error("imageExportTooLarge");
    }
    const handle = await this.getHandle();
    await handle.write(buffer);
    this.offset += buffer.length;
  }

  async addFile(name: string, data: Buffer, modifiedAt = new Date()) {
    if (!data.length) {
      return;
    }
    const encodedName = Buffer.from(name, "utf8");
    if (!encodedName.length || encodedName.length > 0xffff || data.length > 0xffffffff) {
      throw new Error("imageExportInvalidEntry");
    }
    const checksum = crc32(data);
    const { dosDate, dosTime } = toDosDateTime(modifiedAt);
    const localOffset = this.offset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(utf8Flag, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(dosTime, 10);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(encodedName.length, 26);
    header.writeUInt16LE(0, 28);
    await this.write(header);
    await this.write(encodedName);
    await this.write(data);
    this.entries.push({
      name: encodedName,
      crc32: checksum,
      size: data.length,
      offset: localOffset,
      dosDate,
      dosTime,
    });
  }

  async close() {
    const centralOffset = this.offset;
    for (const entry of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(utf8Flag, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(entry.dosTime, 12);
      header.writeUInt16LE(entry.dosDate, 14);
      header.writeUInt32LE(entry.crc32, 16);
      header.writeUInt32LE(entry.size, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE(0, 38);
      header.writeUInt32LE(entry.offset, 42);
      await this.write(header);
      await this.write(entry.name);
    }
    const centralSize = this.offset - centralOffset;
    if (this.entries.length > 0xffff || centralSize > 0xffffffff || centralOffset > 0xffffffff) {
      throw new Error("imageExportTooLarge");
    }
    const footer = Buffer.alloc(22);
    footer.writeUInt32LE(0x06054b50, 0);
    footer.writeUInt16LE(0, 4);
    footer.writeUInt16LE(0, 6);
    footer.writeUInt16LE(this.entries.length, 8);
    footer.writeUInt16LE(this.entries.length, 10);
    footer.writeUInt32LE(centralSize, 12);
    footer.writeUInt32LE(centralOffset, 16);
    footer.writeUInt16LE(0, 20);
    await this.write(footer);
    await this.handle?.close();
    this.handle = null;
    return { entryCount: this.entries.length, byteLength: this.offset };
  }

  async abort() {
    await this.handle?.close().catch(() => undefined);
    this.handle = null;
  }
}
