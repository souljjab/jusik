import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, extractZipEntry, looksLikeZip, readZipEntries, unzipFirst, ZipError } from "../src/zip";

// ───────── 테스트용 아주 작은 ZIP 쓰기(구현과 별도로 CRC를 계산한다) ─────────

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function testCrc(b: Uint8Array): number {
  let c = ~0 >>> 0;
  for (const x of b) c = (TABLE[(c ^ x) & 0xff]! ^ (c >>> 8)) >>> 0;
  return (~c) >>> 0;
}

interface FileSpec {
  name: string;
  data?: string | Uint8Array;
  method?: 0 | 8 | 12;
  /** 로컬 헤더에 크기·CRC를 0으로 쓰고 뒤에 데이터 기술자를 붙인다(비트 3) */
  descriptor?: boolean;
  /** 이름 바이트를 직접 준다(UTF-8 플래그 없음) */
  rawName?: Uint8Array;
  utf8Flag?: boolean;
  /** 로컬 헤더에만 추가 필드를 넣는다(중앙 디렉터리와 길이가 달라지는 경우) */
  localExtra?: number;
  /** 중앙 디렉터리에 기록할 CRC를 일부러 틀리게 */
  badCrc?: boolean;
  encrypted?: boolean;
}

function u16(n: number) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

function makeZip(files: FileSpec[], opts: { comment?: string; prefix?: Uint8Array } = {}): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = opts.prefix?.length ?? 0;
  for (const f of files) {
    const data = typeof f.data === "string" ? Buffer.from(f.data, "utf8") : Buffer.from(f.data ?? new Uint8Array());
    const method = f.method ?? 8;
    const comp = method === 8 ? deflateRawSync(data) : data;
    const crc = f.badCrc ? (testCrc(data) ^ 1) >>> 0 : testCrc(data);
    const name = f.rawName ? Buffer.from(f.rawName) : Buffer.from(f.name, "utf8");
    const flags = (f.descriptor ? 0x8 : 0) | (f.utf8Flag ? 0x800 : 0) | (f.encrypted ? 0x1 : 0);
    const extra = Buffer.alloc(f.localExtra ?? 0);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0x21),
      u32(f.descriptor ? 0 : crc), u32(f.descriptor ? 0 : comp.length), u32(f.descriptor ? 0 : data.length),
      u16(name.length), u16(extra.length), name, extra, comp,
      f.descriptor ? Buffer.concat([u32(0x08074b50), u32(crc), u32(comp.length), u32(data.length)]) : Buffer.alloc(0),
    ]);
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(0), u16(0x21),
      u32(crc), u32(comp.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const comment = Buffer.from(opts.comment ?? "", "utf8");
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(comment.length), comment]);
  return new Uint8Array(Buffer.concat([Buffer.from(opts.prefix ?? new Uint8Array()), ...locals, cd, eocd]));
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>\n<result>\n${"<list><corp_code>00126380</corp_code><corp_name>샘플전자</corp_name><stock_code>005930</stock_code></list>\n".repeat(200)}</result>`;

// ───────── 테스트 ─────────

describe("crc32", () => {
  it("matches the standard check value and the test writer", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    const b = new TextEncoder().encode(XML);
    expect(crc32(b)).toBe(testCrc(b));
  });
});

describe("readZipEntries", () => {
  it("lists entries from the central directory", () => {
    const zip = makeZip([{ name: "dir/", method: 0 }, { name: "dir/a.txt", data: "hello", method: 0 }, { name: "CORPCODE.xml", data: XML }]);
    const entries = readZipEntries(zip);
    expect(entries.map((e) => [e.name, e.method, e.isDirectory])).toEqual([["dir/", 0, true], ["dir/a.txt", 0, false], ["CORPCODE.xml", 8, false]]);
    expect(entries[1]).toMatchObject({ size: 5, compressedSize: 5, crc32: testCrc(Buffer.from("hello")) });
    expect(entries[2]!.size).toBe(Buffer.byteLength(XML));
    expect(entries[2]!.compressedSize).toBeLessThan(entries[2]!.size);
  });

  it("returns [] for bytes that are not a zip (e.g. an error body)", () => {
    expect(readZipEntries(new TextEncoder().encode('<?xml version="1.0"?><result><status>010</status></result>'))).toEqual([]);
    expect(readZipEntries(new TextEncoder().encode('{"status":"013"}'))).toEqual([]);
    expect(readZipEntries(new Uint8Array())).toEqual([]);
    expect(readZipEntries(new Uint8Array(10))).toEqual([]);
  });

  it("finds the end record behind a trailing comment and after leading bytes", () => {
    const zip = makeZip([{ name: "a.txt", data: "x".repeat(100) }], { comment: "주석 comment" });
    expect(readZipEntries(zip).map((e) => e.name)).toEqual(["a.txt"]);
    expect(unzipFirst(zip)?.data.toString()).toBe("x".repeat(100));
  });

  it("decodes names: UTF-8 flag, plain UTF-8 and CP949 fallback", () => {
    const cp949 = new Uint8Array([0xbb, 0xef, 0xbc, 0xba, 0x2e, 0x78, 0x6d, 0x6c]); // "삼성.xml"
    const zip = makeZip([
      { name: "공시.xml", data: "a", utf8Flag: true },
      { name: "목록.xml", data: "b" },
      { name: "", rawName: cp949, data: "c" },
    ]);
    expect(readZipEntries(zip).map((e) => e.name)).toEqual(["공시.xml", "목록.xml", "삼성.xml"]);
  });

  it("throws ZipError when the central directory is broken", () => {
    const zip = makeZip([{ name: "a.txt", data: "hello" }]);
    const broken = zip.slice();
    // 중앙 디렉터리 시작 위치를 망가뜨린다(EOCD의 offset 필드)
    const e = broken.length - 22;
    new DataView(broken.buffer).setUint32(e + 16, 3, true);
    expect(() => readZipEntries(broken)).toThrow(ZipError);
    const zip64 = zip.slice();
    new DataView(zip64.buffer).setUint32(zip64.length - 22 + 16, 0xffffffff, true);
    expect(() => readZipEntries(zip64)).toThrow(/ZIP64/);
  });
});

describe("extractZipEntry / unzipFirst", () => {
  it("inflates deflate entries and copies stored entries", () => {
    const zip = makeZip([{ name: "s.txt", data: "stored 데이터", method: 0 }, { name: "d.xml", data: XML, method: 8 }]);
    const [s, d] = readZipEntries(zip);
    expect(extractZipEntry(zip, s!).toString("utf8")).toBe("stored 데이터");
    expect(extractZipEntry(zip, d!).toString("utf8")).toBe(XML);
  });

  it("handles data-descriptor zips (sizes only in the central directory)", () => {
    const zip = makeZip([{ name: "CORPCODE.xml", data: XML, descriptor: true }, { name: "b.txt", data: "two", descriptor: true, method: 0 }]);
    expect(unzipFirst(zip, "corpcode.xml")?.data.toString("utf8")).toBe(XML);
    expect(unzipFirst(zip, "b.txt")?.data.toString("utf8")).toBe("two");
  });

  it("uses the local header's own name/extra lengths to find the data", () => {
    const zip = makeZip([{ name: "a.txt", data: "local extra differs", localExtra: 9 }]);
    expect(unzipFirst(zip)?.data.toString()).toBe("local extra differs");
  });

  it("matches names by string (case-insensitive, full or base name), RegExp, or defaults to the first file", () => {
    const zip = makeZip([{ name: "docs/", method: 0 }, { name: "docs/readme.txt", data: "r" }, { name: "docs/CORPCODE.xml", data: "<x/>" }]);
    expect(unzipFirst(zip)).toEqual({ name: "docs/readme.txt", data: Buffer.from("r") }); // 폴더는 건너뛴다
    expect(unzipFirst(zip, "CorpCode.XML")?.name).toBe("docs/CORPCODE.xml");
    expect(unzipFirst(zip, "docs/corpcode.xml")?.name).toBe("docs/CORPCODE.xml");
    expect(unzipFirst(zip, /\.xml$/i)?.data.toString()).toBe("<x/>");
    const g = /\.xml$/gi;
    expect(unzipFirst(zip, g)?.name).toBe("docs/CORPCODE.xml");
    expect(unzipFirst(zip, g)?.name).toBe("docs/CORPCODE.xml"); // 전역 정규식의 lastIndex에 휘둘리지 않는다
    expect(unzipFirst(zip, "none.xml")).toBeNull();
    expect(unzipFirst(new TextEncoder().encode("not a zip"))).toBeNull();
  });

  it("rejects corrupt, unsupported, encrypted or oversized entries instead of returning wrong data", () => {
    expect(() => unzipFirst(makeZip([{ name: "a", data: "hello", badCrc: true }]))).toThrow(/CRC/);
    expect(() => unzipFirst(makeZip([{ name: "a", data: "hello", method: 12 }]))).toThrow(/압축 방식\(12\)/);
    expect(() => unzipFirst(makeZip([{ name: "a", data: "hello", encrypted: true }]))).toThrow(/암호화/);
    expect(() => unzipFirst(makeZip([{ name: "a", data: "x".repeat(5000) }]), "a", { maxEntryBytes: 1000 })).toThrow(/너무 커요/);
    // 압축 데이터를 망가뜨림
    const zip = makeZip([{ name: "a", data: XML }]);
    const bad = zip.slice();
    for (let i = 40; i < 60; i++) bad[i] = 0xff;
    expect(() => unzipFirst(bad)).toThrow(ZipError);
    // 데이터가 잘린 경우(중앙 디렉터리는 멀쩡하지만 크기가 파일보다 큼)
    const entries = readZipEntries(zip);
    expect(() => extractZipEntry(zip.subarray(0, 50), entries[0]!)).toThrow(ZipError);
  });

  it("recognizes the ZIP local header signature", () => {
    expect(looksLikeZip(makeZip([{ name: "a", data: "b" }]))).toBe(true);
    expect(looksLikeZip(new TextEncoder().encode("<result/>"))).toBe(false);
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});
