
import { GoogleGenAI, Modality, Type } from "@google/genai";

/**
 * Helper to get a configured Gemini client.
 * Always use process.env.API_KEY directly in the constructor as per guidelines.
 */
export const getGeminiClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

/**
 * Extracts structured chapters from a PDF file.
 */
export async function processPDF(base64Data: string): Promise<{ title: string; author: string; chapters: { title: string; content: string }[] }> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64Data,
          },
        },
        {
          text: "Extract the text from this book and organize it into logical chapters or sections. Return a JSON object with 'title', 'author', and a 'chapters' array where each item has a 'title' and 'content' string. If the book is very long, focus on providing the first 5-10 logical sections to avoid hitting token limits.",
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          author: { type: Type.STRING },
          chapters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                content: { type: Type.STRING },
              },
              required: ["title", "content"],
            },
          },
        },
        required: ["title", "author", "chapters"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
}

/**
 * Generates audio for a specific text snippet.
 */
export async function generateSpeech(text: string): Promise<Uint8Array> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Narrate the following text clearly and with expression: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error("No audio data returned from Gemini TTS");
  }

  return decode(base64Audio);
}

/**
 * Helper: Decode base64 to Uint8Array.
 * Manual implementation to avoid external dependencies.
 */
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Helper: Raw PCM decoding for AudioContext.
 * The Gemini TTS returns raw PCM data without standard file headers.
 */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
