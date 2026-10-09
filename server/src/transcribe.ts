import { spawn } from 'node:child_process';
import { createReadStream, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openai } from './brain.ts';
import { trackOpenAI } from './usage.ts';

// Transcrição de gravações (passo "Pedir informação" dos workflows): o ffmpeg converte para mp3 mono 32 kbps
// e corta em partes de 10 min (a API aceita até 25 MB por arquivo); cada parte vai para o gpt-4o-transcribe,
// com o whisper-1 de reserva. O custo entra no Consumo (ai_usage) como "Transcrição de áudio".

export const PART_SECONDS = 600;
const MODELS = ['gpt-4o-transcribe', 'whisper-1'];

export interface TranscribeResult {
  text: string;
  seconds: number; // duração total do áudio
  parts: number;
  model: string;
}

type Client = (file: string, model: string) => Promise<{ text: string; usage?: unknown }>;

const openaiClient: Client = async (file, model) => {
  const r = await openai.audio.transcriptions.create({ file: createReadStream(file), model, language: 'pt' });
  return { text: r.text, usage: (r as { usage?: unknown }).usage };
};
let client: Client = openaiClient;
/** Troca o cliente de transcrição (testes). null volta à OpenAI. */
export function setTranscribeClient(c: Client | null) {
  client = c ?? openaiClient;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c: Buffer) => {
      err = (err + c.toString()).slice(-20_000);
    });
    p.on('error', (e) => reject(new Error(`${cmd} indisponível: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`${cmd} falhou (${code}): ${err.trim().split('\n').slice(-2).join(' ')}`))));
  });
}

const durationOf = (log: string) => {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};

/** Converte e corta em partes de 10 min. Devolve os caminhos (ordem) e a duração total. Quem chama apaga `dir`. */
export async function splitAudio(file: string, dir: string, partSeconds = PART_SECONDS): Promise<{ parts: string[]; seconds: number }> {
  const log = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k',
    '-f', 'segment', '-segment_time', String(partSeconds), '-reset_timestamps', '1', join(dir, 'parte-%03d.mp3'),
  ]);
  const parts = readdirSync(dir).filter((f) => /^parte-\d+\.mp3$/.test(f)).sort().map((f) => join(dir, f));
  if (!parts.length) throw new Error('o áudio não tem som que dê para transcrever');
  return { parts, seconds: durationOf(log) };
}

export async function transcribe(file: string, onProgress?: (done: number, total: number) => void): Promise<TranscribeResult> {
  const dir = mkdtempSync(join(tmpdir(), 'atria-tr-'));
  try {
    const { parts, seconds } = await splitAudio(file, dir);
    const texts: string[] = [];
    let used = MODELS[0];
    for (let i = 0; i < parts.length; i++) {
      onProgress?.(i, parts.length);
      const partSec = i < parts.length - 1 ? PART_SECONDS : Math.max(1, seconds - PART_SECONDS * (parts.length - 1));
      let lastErr: Error | null = null;
      let text: string | null = null;
      for (const model of MODELS) {
        try {
          const r = await client(parts[i], model);
          // gpt-4o-transcribe devolve tokens; whisper-1 é cobrado por minuto
          trackOpenAI('workflow-transcricao', model, r.usage, { seconds: partSec });
          text = r.text.trim();
          used = model;
          break;
        } catch (e) {
          lastErr = e as Error;
          console.error(`transcrição parte ${i + 1}/${parts.length} (${model})`, lastErr.message);
        }
      }
      if (text === null) throw new Error(`não consegui transcrever a parte ${i + 1} de ${parts.length}: ${lastErr?.message ?? 'erro'}`);
      texts.push(text);
    }
    onProgress?.(parts.length, parts.length);
    return { text: texts.join('\n\n'), seconds, parts: parts.length, model: used };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
