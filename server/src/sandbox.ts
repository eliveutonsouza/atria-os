import { createHmac } from 'node:crypto';
import { config } from './config.ts';

// Iframe com sandbox (origem opaca) não envia cookie SameSite=Strict nos sub-recursos,
// então o preview é acessado por token HMAC no caminho em vez de sessão.
export const sbToken = (slug: string) => createHmac('sha256', config.sessionSecret).update(`sandbox:${slug}`).digest('base64url').slice(0, 24);
export const sandboxUrl = (slug: string) => `/sandbox/${sbToken(slug)}/${slug}/`;
