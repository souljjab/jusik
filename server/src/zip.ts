import { inflateRawSync } from "node:zlib";

/*
 * 아주 작은 ZIP 읽기 — DART corpCode.xml 내려받기(ZIP 한 파일)를 풀려고 만들었다.
 * 끝의 중앙 디렉터리 종료 레코드(EOCD) → 중앙 디렉터리 순으로 읽으므로, 로컬 헤더의 크기가 0인
 * 데이터 기술자(data descriptor, 플래그 비트 3) 방식 ZIP도 풀린다. 압축 방식은 0(저장)과 8(deflate)만 지원한다.
 * ZIP64·암호화·여러 디스크 분할은 지원하지 않는다(ZipError).
 */

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  /** 0 저장, 8 deflate */
  method: number;
  /** 일반 목적 플래그(비트 0 암호화, 비트 3 데이터 기술자, 비트 11 UTF-8 이름) */
  flags: number;
  crc32: number;
  compressedSize: number;
  size: number;
  /** 로컬 파일 헤더 위치 */
  localOffset: number;
  isDirectory: boolean;
}

/** 풀기 한도(앱 기본값). corpCode.xml은 수십 MB라 넉넉히 두되 압축 폭탄은 막는다 */
export const ZIP_LIMITS = {
  /** 한 파일을 풀었을 때 최대 크기(바이트) */
  maxEntryBytes: 256 * 1024 * 1024,
} as const;

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const EOCD_MIN = 22;

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** 끝에서부터 EOCD 서명을 찾는다(뒤에 최대 65535바이트 주석이 붙을 수 있다). 없으면 -1 */
function findEocd(b: Uint8Array): number {
  const dv = view(b);
  const stop = Math.max(0, b.length - EOCD_MIN - 0xffff);
  for (let i = b.length - EOCD_MIN; i >= stop; i--) {
    if (dv.getUint32(i, true) !== SIG_EOCD) continue;
    // 주석이 파일 안에 들어가야 EOCD로 본다. 끝에서부터 찾으므로 진짜 EOCD가 먼저 걸린다
    if (i + EOCD_MIN + dv.getUint16(i + 20, true) <= b.length) return i;
  }
  return -1;
}

function decodeName(raw: Uint8Array, flags: number): string {
  if (flags & 0x800) return new TextDecoder("utf-8").decode(raw);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    // 국내 압축 프로그램은 CP949로 이름을 쓰는 경우가 많다
    return new TextDecoder("euc-kr").decode(raw);
  }
}

/**
 * 중앙 디렉터리의 파일 목록. ZIP이 아니면(EOCD 없음, 예: 오류 XML·JSON 응답) [].
 * EOCD는 있는데 구조가 깨졌거나 ZIP64·분할 ZIP이면 ZipError.
 */
export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length < EOCD_MIN) return [];
  const e = findEocd(bytes);
  if (e < 0) return [];
  const dv = view(bytes);
  const disk = dv.getUint16(e + 4, true), cdDisk = dv.getUint16(e + 6, true);
  const total = dv.getUint16(e + 10, true);
  const cdSize = dv.getUint32(e + 12, true), cdOffset = dv.getUint32(e + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError("ZIP64 형식은 지원하지 않아요");
  if (disk !== 0 || cdDisk !== 0) throw new ZipError("여러 파일로 나뉜 ZIP은 지원하지 않아요");
  if (cdOffset + cdSize > e) throw new ZipError("ZIP 중앙 디렉터리 위치가 잘못됐어요");

  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let k = 0; k < total; k++) {
    if (p + 46 > e || dv.getUint32(p, true) !== SIG_CEN) throw new ZipError("ZIP 중앙 디렉터리가 깨졌어요");
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc32 = dv.getUint32(p + 16, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    if (p + 46 + nameLen > e) throw new ZipError("ZIP 중앙 디렉터리가 깨졌어요");
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), flags);
    out.push({ name, method, flags, crc32, compressedSize, size, localOffset, isDirectory: name.endsWith("/") });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

let CRC_TABLE: Uint32Array | null = null;

/** CRC-32(IEEE, ZIP과 같은 다항식) */
export function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 한 항목을 푼다. 크기는 중앙 디렉터리 값을 믿고(데이터 기술자 대응), CRC와 풀린 크기가 다르면 ZipError */
export function extractZipEntry(bytes: Uint8Array, entry: ZipEntry, limits: { maxEntryBytes?: number } = {}): Buffer {
  const max = limits.maxEntryBytes ?? ZIP_LIMITS.maxEntryBytes;
  if (entry.flags & 0x1) throw new ZipError(`암호화된 ZIP 항목은 풀 수 없어요: ${entry.name}`);
  if (entry.size > max) throw new ZipError(`ZIP 항목이 너무 커요: ${entry.name}`);
  const dv = view(bytes);
  const p = entry.localOffset;
  if (p + 30 > bytes.length || dv.getUint32(p, true) !== SIG_LOC) throw new ZipError(`ZIP 로컬 헤더가 깨졌어요: ${entry.name}`);
  // 로컬 헤더의 이름·추가 필드 길이는 중앙 디렉터리와 다를 수 있어 로컬 값을 쓴다
  const start = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new ZipError(`ZIP 데이터가 잘렸어요: ${entry.name}`);
  const raw = bytes.subarray(start, end);

  let data: Buffer;
  if (entry.method === 0) data = Buffer.from(raw);
  else if (entry.method === 8) {
    try {
      data = inflateRawSync(raw, { maxOutputLength: Math.max(1, max) });
    } catch (e) {
      throw new ZipError(`ZIP 압축을 풀지 못했어요(${entry.name}): ${e instanceof Error ? e.message : String(e)}`);
    }
  } else throw new ZipError(`지원하지 않는 압축 방식(${entry.method})이에요: ${entry.name}`);

  if (data.length !== entry.size) throw new ZipError(`ZIP 항목 크기가 맞지 않아요: ${entry.name}`);
  if (crc32(data) !== entry.crc32) throw new ZipError(`ZIP CRC가 맞지 않아요(파일이 깨졌어요): ${entry.name}`);
  return data;
}

/**
 * 조건에 맞는 첫 파일(폴더 제외)을 푼다. nameMatch가 문자열이면 대소문자 무시로 전체 이름 또는 마지막 경로 조각과 같은지,
 * 정규식이면 전체 이름에 맞는지 본다. 없으면 첫 파일. ZIP이 아니거나 맞는 파일이 없으면 null.
 */
export function unzipFirst(bytes: Uint8Array, nameMatch?: string | RegExp, limits?: { maxEntryBytes?: number }): { name: string; data: Buffer } | null {
  const want = (name: string) => {
    if (nameMatch == null) return true;
    if (typeof nameMatch === "string") {
      const n = nameMatch.toLowerCase(), full = name.toLowerCase();
      return full === n || full.split("/").at(-1) === n;
    }
    nameMatch.lastIndex = 0;
    return nameMatch.test(name);
  };
  const entry = readZipEntries(bytes).find((x) => !x.isDirectory && want(x.name));
  return entry ? { name: entry.name, data: extractZipEntry(bytes, entry, limits) } : null;
}

/** 바이트가 ZIP 로컬 헤더 서명("PK\x03\x04")으로 시작하는지 */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
