// @ts-nocheck — vendored unmodified from github.com/binimum/am-lyrics (MPL-2.0, see ./LICENSE).
/**
 * Config for GoogleService
 */
const CONFIG = {
  GOOGLE: {
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 1000,
    FETCH_TIMEOUT_MS: 6000,
  },
};

interface RomanizableLine {
  text?: { text: string; romanizedText?: string }[] | string;
  romanizedText?: string;
  isWordSynced?: boolean;
}

/**
 * Service for translating and romanizing text using Google Translate (unofficial API)
 */
export class GoogleService {
  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  private static fetchWithTimeout(
    url: string,
    timeoutMs = CONFIG.GOOGLE.FETCH_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal }).finally(() =>
      clearTimeout(timeoutId),
    );
  }

  private static isPurelyLatinScript(text: string): boolean {
    // Basic check for Latin script characters plus common punctuation and numbers
    // eslint-disable-next-line no-control-regex
    return /^[\u0000-\u007F\u0080-\u00FF\u0100-\u017F\u0180-\u024F]*$/.test(
      text,
    );
  }

  private static translationCache = new Map<string, string>();

  static async translate(
    textOrArray: string | string[],
    targetLang: string,
  ): Promise<string | string[]> {
    if (
      !textOrArray ||
      (Array.isArray(textOrArray) && textOrArray.length === 0)
    ) {
      return Array.isArray(textOrArray) ? [] : '';
    }

    const isArray = Array.isArray(textOrArray);
    const texts = isArray ? (textOrArray as string[]) : [textOrArray as string];

    const nonEmptyIndices: number[] = [];
    const textsToTranslate: string[] = [];

    texts.forEach((t, i) => {
      if (t && t.trim()) {
        nonEmptyIndices.push(i);
        textsToTranslate.push(t);
      }
    });

    if (textsToTranslate.length === 0) {
      return isArray ? texts : texts[0];
    }

    const translatedResults: string[] = new Array(textsToTranslate.length).fill('');
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    textsToTranslate.forEach((t, i) => {
      const hit = GoogleService.translationCache.get(`${targetLang}::${t}`);
      if (hit !== undefined) translatedResults[i] = hit;
      else {
        uncachedIndices.push(i);
        uncachedTexts.push(t);
      }
    });

    if (uncachedTexts.length === 0) {
      const cachedOut = [...texts];
      nonEmptyIndices.forEach((realIdx, mappedIdx) => {
        cachedOut[realIdx] = translatedResults[mappedIdx];
      });
      return isArray ? cachedOut : cachedOut[0];
    }

    // Detect dominant source language once across the song so mixed/romanized lines don't flip languages per batch
    let sourceLang = 'auto';
    try {
      const sample = uncachedTexts.slice(0, 8).join(' ').slice(0, 400);
      const detectUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(sample)}`;
      const detectRes = await GoogleService.fetchWithTimeout(detectUrl);
      if (detectRes.ok) {
        const detectData = await detectRes.json();
        if (typeof detectData?.[2] === 'string' && detectData[2]) {
          sourceLang = detectData[2];
        }
      }
    } catch {}

    // If the song is already in the target language, return originals cleanly without garbling
    if (sourceLang === targetLang || sourceLang.startsWith(`${targetLang}-`)) {
      uncachedIndices.forEach((idx, i) => {
        translatedResults[idx] = uncachedTexts[i];
        GoogleService.translationCache.set(`${targetLang}::${uncachedTexts[i]}`, uncachedTexts[i]);
      });
      const sameLangOut = [...texts];
      nonEmptyIndices.forEach((realIdx, mappedIdx) => {
        sameLangOut[realIdx] = translatedResults[mappedIdx];
      });
      return isArray ? sameLangOut : sameLangOut[0];
    }

    const BATCH_SIZE_CHARS = 1200;
    let currentBatch: string[] = [];
    let currentBatchIndices: number[] = [];
    let currentBatchLength = 0;

    const processBatch = async (batch: string[], indices: number[]) => {
      if (batch.length === 0) return;
      // Line-locked markers prevent Google Translate from merging or splitting lines
      const markedText = batch.map((line, idx) => `[#${idx}] ${line}`).join('\n');

      let attempt = 0;
      let success = false;

      while (attempt < CONFIG.GOOGLE.MAX_RETRIES && !success) {
        try {
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(markedText)}`;
          // eslint-disable-next-line no-await-in-loop
          const response = await GoogleService.fetchWithTimeout(url);
          if (!response.ok) throw new Error(`Status ${response.status}`);
          // eslint-disable-next-line no-await-in-loop
          const data = await response.json();

          const fullTranslation =
            data?.[0]?.map((seg: any) => seg?.[0]).join('') || '';

          // Parse back by [#idx] markers first for 1:1 line alignment
          const mapped = new Map<number, string>();
          const markerRe = /\[#\s*(\d+)\s*\]\s*([^\n[]*(?:\n(?!\[#\s*\d+\s*\])[^\n]*)*)/g;
          let m: RegExpExecArray | null;
          while ((m = markerRe.exec(fullTranslation)) !== null) {
            const idx = Number(m[1]);
            const val = m[2].replace(/\s+/g, ' ').trim();
            if (Number.isInteger(idx) && val) mapped.set(idx, val);
          }

          const fallbackLines = fullTranslation.split('\n').map((s: string) => s.replace(/^\s*\[#\s*\d+\s*\]\s*/, '').trim());

          indices.forEach((originalIdx, i) => {
            const val = mapped.get(i) || fallbackLines[i] || batch[i];
            translatedResults[originalIdx] = val;
            GoogleService.translationCache.set(`${targetLang}::${batch[i]}`, val);
          });

          success = true;
        } catch (e) {
          attempt += 1;
          if (attempt < CONFIG.GOOGLE.MAX_RETRIES) {
            // eslint-disable-next-line no-await-in-loop
            await GoogleService.delay(
              CONFIG.GOOGLE.RETRY_DELAY_MS * 2 ** (attempt - 1),
            );
          } else {
            indices.forEach((originalIdx, i) => {
              translatedResults[originalIdx] = batch[i];
            });
          }
        }
      }
    };

    for (let i = 0; i < uncachedTexts.length; i += 1) {
      const text = uncachedTexts[i];
      if (currentBatchLength + text.length + 8 > BATCH_SIZE_CHARS) {
        // eslint-disable-next-line no-await-in-loop
        await processBatch(currentBatch, currentBatchIndices);
        currentBatch = [];
        currentBatchIndices = [];
        currentBatchLength = 0;
      }
      currentBatch.push(text);
      currentBatchIndices.push(uncachedIndices[i]);
      currentBatchLength += text.length + 8;
    }

    if (currentBatch.length > 0) {
      await processBatch(currentBatch, currentBatchIndices);
    }

    const finalArray = [...texts];
    nonEmptyIndices.forEach((realIdx, mappedIdx) => {
      finalArray[realIdx] = translatedResults[mappedIdx];
    });

    return isArray ? finalArray : finalArray[0];
  }

  static async romanize<T extends RomanizableLine>(
    originalLyrics: T[] | { data?: T[]; content?: T[] },
  ): Promise<T[]> {
    // Determine if we should treat as word-synced (has syllabus) or line-synced
    const lines: T[] = Array.isArray(originalLyrics)
      ? originalLyrics
      : (originalLyrics as { data?: T[]; content?: T[] }).data ||
        (originalLyrics as { data?: T[]; content?: T[] }).content ||
        [];

    if (!lines || lines.length === 0)
      return Array.isArray(originalLyrics) ? originalLyrics : [];

    // Check if word synced
    const isWordSynced = lines.some(
      (l: RomanizableLine) =>
        l.isWordSynced !== false && Array.isArray(l.text) && l.text.length > 1,
    );

    if (isWordSynced) {
      return this.romanizeWordSynced(lines);
    }

    return this.romanizeLineSynced(lines);
  }

  static async romanizeWordSynced<T extends RomanizableLine>(
    lines: T[],
  ): Promise<T[]> {
    return Promise.all(
      lines.map(async (line: T) => {
        if (
          !line.text ||
          !Array.isArray(line.text) ||
          line.text.length === 0 ||
          line.romanizedText // Skip if already romanized
        )
          return line;

        // Get the entire line text to romanize together for context-aware pronunciation
        const fullText = line.text
          .map((s: { text: string }) => s.text)
          .join('');

        // romanizeTexts expects an array of strings, so we pass an array of one
        const [romanizedFullLine] = await this.romanizeTexts([fullText]);

        const newSyllabus = line.text.map(
          (s: { text: string; romanizedText?: string }) => ({
            ...s,
            romanizedText: s.romanizedText, // Keep any existing syllabus romanization if provided by API natively
          }),
        );

        return {
          ...line,
          text: newSyllabus,
          romanizedText: romanizedFullLine || '',
        };
      }),
    );
  }

  static async romanizeLineSynced<T extends RomanizableLine>(
    lines: T[],
  ): Promise<T[]> {
    const linesToRomanize = lines.map((line: T) => {
      // If already romanized, skip
      if (line.romanizedText) {
        return '';
      }
      // If it's line-synced, it usually has 1 syllable with the full text.
      if (Array.isArray(line.text) && line.text.length > 0) {
        return line.text.map((s: { text: string }) => s.text).join('');
      }
      return '';
    });

    const romanizedLines = await this.romanizeTexts(linesToRomanize);

    return lines.map((line: T, index: number) => ({
      ...line,
      romanizedText: romanizedLines[index] || '',
    }));
  }

  static async romanizeTexts(texts: string[]): Promise<string[]> {
    const contextText = texts.join(' ');

    if (GoogleService.isPurelyLatinScript(contextText)) {
      return texts;
    }

    const romanizedTexts: string[] = [];

    /* eslint-disable no-await-in-loop */
    for (const text of texts) {
      if (!text || GoogleService.isPurelyLatinScript(text)) {
        romanizedTexts.push(text);
      } else {
        let attempt = 0;
        let success = false;
        let lastError = null;

        while (attempt < CONFIG.GOOGLE.MAX_RETRIES && !success) {
          try {
            const romanizeUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=rm&q=${encodeURIComponent(
              text,
            )}`;
            const response = await GoogleService.fetchWithTimeout(romanizeUrl);
            const data = await response.json();

            // Response format is [[["...","...","...","romanization"]],...]
            // or [null, ...] for English/Latin input where no romanization is needed
            const romanized = data?.[0]?.[0]?.[3] || text;

            romanizedTexts.push(romanized);
            success = true;
          } catch (error) {
            lastError = error;
            // eslint-disable-next-line no-console
            console.warn(
              `GoogleService: Error romanizing text "${text}" (attempt ${
                attempt + 1
              }/${CONFIG.GOOGLE.MAX_RETRIES}):`,
              error,
            );
            attempt += 1;
            if (attempt < CONFIG.GOOGLE.MAX_RETRIES) {
              await GoogleService.delay(
                CONFIG.GOOGLE.RETRY_DELAY_MS * 2 ** (attempt - 1),
              ); // Exponential backoff
            }
          }
        }

        if (!success) {
          // eslint-disable-next-line no-console
          console.error(
            `GoogleService: Failed to romanize text "${text}" after ${CONFIG.GOOGLE.MAX_RETRIES} attempts. Last error:`,
            lastError,
          );
          romanizedTexts.push(text); // Fallback to original text
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    return romanizedTexts;
  }
}
