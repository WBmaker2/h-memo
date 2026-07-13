const MEMO_DOCUMENT_ID_PREFIX = "memo~";
const SAFE_RAW_MEMO_ID = /^[A-Za-z0-9_-]+$/;
const ENCODED_MEMO_DOCUMENT_ID = /^memo~(?:[0-9a-fA-F]{4})*$/;

function encodeUtf16CodeUnits(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded;
}

function decodeUtf16CodeUnits(value: string): string {
  if (!/^(?:[0-9a-f]{4})*$/i.test(value)) {
    throw new Error("Invalid memo document ID codec value.");
  }

  let decoded = "";
  for (let index = 0; index < value.length; index += 4) {
    decoded += String.fromCharCode(Number.parseInt(value.slice(index, index + 4), 16));
  }
  return decoded;
}

export function encodeMemoDocumentId(memoId: string): string {
  if (
    memoId.length > 0 &&
    SAFE_RAW_MEMO_ID.test(memoId) &&
    !memoId.startsWith(MEMO_DOCUMENT_ID_PREFIX)
  ) {
    return memoId;
  }

  return `${MEMO_DOCUMENT_ID_PREFIX}${encodeUtf16CodeUnits(memoId)}`;
}

export function decodeMemoDocumentId(documentId: string): string {
  if (!ENCODED_MEMO_DOCUMENT_ID.test(documentId)) {
    return documentId;
  }

  return decodeUtf16CodeUnits(documentId.slice(MEMO_DOCUMENT_ID_PREFIX.length));
}

export function isMemoDocumentIdFor(documentId: string, memoId: string): boolean {
  // A legacy raw document may itself look like an encoded path. Prefer the
  // stored original ID before attempting the v2 codec.
  if (documentId === memoId) {
    return true;
  }

  if (ENCODED_MEMO_DOCUMENT_ID.test(documentId)) {
    try {
      return decodeMemoDocumentId(documentId) === memoId;
    } catch {
      return false;
    }
  }

  return documentId === memoId;
}

export function canUseLegacyRawMemoDocumentId(memoId: string): boolean {
  return (
    memoId.length > 0 &&
    memoId !== "." &&
    memoId !== ".." &&
    !memoId.includes("/")
  );
}
