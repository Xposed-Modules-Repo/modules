export class LFH {
  comp: number = 0
  compSize: number = 0
  decompSize: number = 0
  fnLen: number = 0
  efLen: number = 0

  public static readonly HEADER_SIZE = 30

  size(): number {
    return LFH.HEADER_SIZE + this.fnLen + this.efLen
  }

  constructor(buf: Buffer, cd?: CD) {
    this.comp = buf.readUInt16LE(8)
    this.compSize = buf.readUInt32LE(18)
    this.decompSize = buf.readInt32LE(22)
    if (this.compSize <= 0 && cd !== undefined) cd.compSize
    if (cd !== undefined) {
      if (this.compSize <= 0) this.compSize = cd.compSize
      if (this.decompSize <= 0) this.decompSize = cd.decompSize
    }
    this.fnLen = buf.readUInt16LE(26)
    this.efLen = buf.readUInt16LE(28)
  }
}

export class CD {
  comp: number = 0
  compSize: number = 0
  decompSize: number = 0
  fnLen: number = 0
  efLen: number = 0
  fcLen: number = 0
  fileOffset: number = 0
  filename: string = ""

  public static readonly HEADER_SIZE = 46

  size(): number {
    return CD.HEADER_SIZE + this.fnLen + this.efLen + this.fcLen
  }

  constructor(buf: Buffer, offset: number = 0) {
    this.comp = buf.readUInt16LE(offset + 10)
    this.compSize = buf.readUInt32LE(offset + 20)
    this.decompSize = buf.readUint32LE(offset + 24)
    this.fnLen = buf.readUInt16LE(offset + 28)
    this.efLen = buf.readUInt16LE(offset + 30)
    this.fcLen = buf.readUInt16LE(offset + 32)
    this.fileOffset = buf.readUInt32LE(offset + 42)
    this.filename = buf
      .subarray(offset + CD.HEADER_SIZE, offset + CD.HEADER_SIZE + this.fnLen)
      .toString()
  }
}

export class EOCD {
  entries: number = 0
  cdSize: number = 0

  public static readonly HEADER_SIZE = 22
  public static readonly SIGNATURE = 1347093766

  constructor(buf: Buffer) {
    if (buf.readUint32BE() !== EOCD.SIGNATURE)
      throw new ApkError("Invalid EOCD")
    this.entries = buf.readUInt16LE(8)
    this.cdSize = buf.readUInt32LE(12)
  }
}

export class ApkError extends Error {
  constructor(message: string) {
    super(message)
  }
}
