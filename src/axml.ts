enum ResType {
  RES_NULL_TYPE = 0x0000,
  RES_STRING_POOL_TYPE = 0x0001,
  RES_XML_TYPE = 0x0003,

  RES_XML_FIRST_CHUNK_TYPE = 0x0100,
  RES_XML_START_ELEMENT_TYPE = 0x0102,
  RES_XML_LAST_CHUNK_TYPE = 0x017f,
  RES_XML_RESOURCE_MAP_TYPE = 0x0180,
}

enum DataType {
  TYPE_NULL = 0x00,
  TYPE_STRING = 0x03,
  TYPE_INT_DEC = 0x10,
  TYPE_INT_BOOLEAN = 0x12,
}

class Res_value {
  dataType: DataType = 0
  data: number = 0

  public static readonly SIZE = 8

  constructor(chunk?: Buffer, offset?: number) {
    if (chunk == undefined || offset == undefined) return
    this.dataType = chunk.readUInt8(offset + 3)
    this.data = chunk.readUInt32LE(offset + 4)
  }
}

class ResStringPool_header {
  header: ResChunk_header
  stringCount: number
  styleCount: number
  flags: number
  stringsStart: number
  stylesStart: number

  public static readonly SIZE = 28

  constructor(chunk: Buffer, offset: number, header?: ResChunk_header) {
    if (header) {
      this.header = header
    } else {
      this.header = new ResChunk_header(chunk, offset)
    }
    this.stringCount = chunk.readUint32LE(offset + 8)
    this.styleCount = chunk.readUint32LE(offset + 12)
    this.flags = chunk.readUint32LE(offset + 16)
    this.stringsStart = chunk.readUint32LE(offset + 20)
    this.stylesStart = chunk.readUint32LE(offset + 24)
  }
}

class ResChunk_header {
  type: ResType = 0
  size: number = 0
  chunkSize: number = 0

  public static readonly SIZE = 8

  constructor(chunk?: Buffer, offset?: number) {
    if (chunk == undefined || offset == undefined) return
    this.type = chunk.readUInt16LE(offset)
    this.size = chunk.readUInt16LE(offset + 2)
    this.chunkSize = chunk.readUInt32LE(offset + 4)
  }
}

class ResXMLTree_node {
  header: ResChunk_header = new ResChunk_header()
  lineNumber: number = 0
  comment: number = 0

  public static readonly SIZE = 16

  constructor(chunk?: Buffer, offset?: number, header?: ResChunk_header) {
    if (chunk == undefined || offset == undefined) return
    if (header) {
      this.header = header
    } else {
      this.header = new ResChunk_header(chunk, offset)
    }
    this.lineNumber = chunk.readUInt32LE(offset + 8)
    this.comment = chunk.readUInt32LE(offset + 12)
  }
}

class ResXMLTree_attrExt {
  ns: number = 0
  name: number = 0
  attributeStart: number = 0
  attributeSize: number = 0
  attributeCount: number = 0
  idIndex: number = 0
  classIndex: number = 0
  styleIndex: number = 0

  public static readonly SIZE = 20

  constructor(chunk?: Buffer, offset?: number) {
    if (chunk == undefined || offset == undefined) return
    this.ns = chunk.readUInt32LE(offset)
    this.name = chunk.readUInt32LE(offset + 4)
    this.attributeStart = chunk.readUInt16LE(offset + 8)
    this.attributeSize = chunk.readUInt16LE(offset + 10)
    this.attributeCount = chunk.readUInt16LE(offset + 12)
    this.idIndex = chunk.readUInt16LE(offset + 14)
    this.classIndex = chunk.readUInt16LE(offset + 16)
    this.styleIndex = chunk.readUInt16LE(offset + 18)
  }
}

class ResXMLTree_attribute {
  ns: number = 0
  name: number = 0
  rawValue: number = 0
  typedValue: Res_value = new Res_value()

  public static readonly SIZE = 20

  constructor(chunk?: Buffer, offset?: number) {
    if (chunk == undefined || offset == undefined) return
    this.ns = chunk.readUInt32LE(offset)
    this.name = chunk.readInt32LE(offset + 4)
    this.rawValue = chunk.readInt32LE(offset + 8)
    this.typedValue = new Res_value(chunk, offset + 12)
  }
}

export class AndroidManifest {
  versionCode: number = 0
  versionName: string = ""
  package: string = ""
  xposedMinVersion: string = ""
  isXposed: boolean = false
  isNewSXP: boolean = false

  private stringEntries: number[] = []
  private strsOff: number = 0
  private chunk: Buffer
  private charSize: number = 1

  getString = (idx: number): string => {
    const strIdxOff = this.stringEntries[idx]
    if (strIdxOff == undefined) return ""
    const lenOff = this.strsOff + strIdxOff
    const highbit = this.charSize === 2 ? 0x8000 : 0x80
    let len =
      (this.charSize === 2
        ? this.chunk.readUInt16LE(lenOff)
        : this.chunk.readUInt8(lenOff)) * this.charSize
    if (len & highbit) {
      const len2 =
        this.charSize === 2
          ? this.chunk.readUInt16LE(lenOff + 1)
          : this.chunk.readUInt8(lenOff + 1)
      if (this.charSize === 2) {
        len = ((len & 0x7fff) << 16) | len2
      } else {
        len = ((len & 0x7f) << 8) | len2
      }
    }
    return this.chunk.toString(
      this.charSize === 2 ? "utf16le" : "utf8",
      lenOff + 2,
      lenOff + 2 + len,
    )
  }

  constructor(chunk: Buffer) {
    this.chunk = chunk
    let offset = 0
    const headerXML = new ResChunk_header(chunk, offset)
    if (headerXML.type != ResType.RES_XML_TYPE) {
      throw Error("expected header type != ResType.RES_XML_TYPE")
    }
    if (headerXML.size != ResChunk_header.SIZE) {
      throw Error("expected header size != ResChunk_header.SIZE")
    }
    if (headerXML.chunkSize != chunk.length) {
      throw Error("expected chunk size != AndroidManifest.xml size")
      return
    }
    offset += headerXML.size

    while (offset < headerXML.chunkSize) {
      const header = new ResChunk_header(chunk, offset)
      if (header.type == ResType.RES_STRING_POOL_TYPE) {
        const stringPoolHeader = new ResStringPool_header(chunk, offset, header)

        this.charSize = (stringPoolHeader.flags & 0x100) != 0 ? 1 : 2
        let stringPoolSize = 0
        if (stringPoolHeader.styleCount == 0) {
          stringPoolSize = header.chunkSize - stringPoolHeader.stringsStart
        } else {
          stringPoolSize =
            stringPoolHeader.stylesStart - stringPoolHeader.stringsStart
        }

        offset += ResStringPool_header.SIZE

        for (let i = 0; i < stringPoolHeader.stringCount; i++) {
          this.stringEntries.push(chunk.readUInt32LE(offset + i * 4))
        }

        offset += stringPoolHeader.stringCount * 4

        this.strsOff = offset

        offset += stringPoolSize
      } else if (header.type == ResType.RES_XML_RESOURCE_MAP_TYPE) {
        const resIds: number[] = []
        const resourceMapSize = header.chunkSize - header.size
        offset += ResChunk_header.SIZE
        for (let i = 0; i < resourceMapSize / 4; i++) {
          resIds.push(chunk.readUInt32LE(offset + i * 4))
        }
        offset += resourceMapSize
      } else if (
        header.type >= ResType.RES_XML_FIRST_CHUNK_TYPE ||
        header.type <= ResType.RES_XML_LAST_CHUNK_TYPE
      ) {
        if (header.type === ResType.RES_XML_START_ELEMENT_TYPE) {
          const element = new ResXMLTree_attrExt(
            chunk,
            offset + ResXMLTree_node.SIZE,
          )
          const elementName = this.getString(element.name)

          let name = ""
          for (let i = 0; i < element.attributeCount; i++) {
            const attr = new ResXMLTree_attribute(
              chunk,
              offset +
                ResXMLTree_node.SIZE +
                ResXMLTree_attrExt.SIZE +
                i * ResXMLTree_attrExt.SIZE,
            )

            const attrName = this.getString(attr.name)

            if (elementName == "manifest") {
              switch (attrName) {
                case "versionCode":
                  this.versionCode = attr.typedValue.data
                  break
                case "versionName":
                  this.versionName = this.getString(attr.typedValue.data)
                  break
                case "package":
                  this.package = this.getString(attr.typedValue.data)
                  break
                default:
                  break
              }
            }

            if (elementName == "meta-data") {
              if (attrName == "name") {
                name = this.getString(attr.typedValue.data)
              }
              if (attrName == "value") {
                if (name === "xposedminversion") {
                  this.isXposed = true
                  if (attr.typedValue.dataType === DataType.TYPE_INT_DEC) {
                    this.xposedMinVersion = attr.typedValue.data.toString()
                    if (attr.typedValue.data >= 93) {
                      this.isNewSXP = true
                    }
                  }
                  if (attr.typedValue.dataType === DataType.TYPE_STRING) {
                    this.xposedMinVersion = this.getString(attr.typedValue.data)
                  }
                }
                if (
                  name === "xposedsharedprefs" &&
                  attr.typedValue.dataType === DataType.TYPE_INT_BOOLEAN &&
                  attr.typedValue.data != 0
                ) {
                  this.isNewSXP = true
                }
              }
            }
          }
        }

        offset += header.chunkSize
      } else {
        console.warn("UNKNOWN TYPE", header.type)
        offset += header.chunkSize
      }
    }
  }
}
