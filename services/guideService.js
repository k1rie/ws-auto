import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// URL de la guía (puede sobreescribirse por env)
const GUIDE_URL = process.env.GUIDE_DOC_URL || 'https://docs.google.com/document/d/1ftDTiak0Ov5pyGg5VE2bFd_kDXZxADcuLURiXKaq2aI/edit?usp=sharing';

// Cache in-memory para evitar hits innecesarios
let cachedGuideText = null;
let cachedGuideExpiresAt = 0;
let cachedAccessToken = null;
let cachedTokenExpiresAt = 0;

function loadServiceAccountKey() {
  // Opción 1: JSON completo en variable de entorno
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    } catch (error) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY no es un JSON válido');
    }
  }

  // Opción 2: ruta a archivo
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
  if (keyPath) {
    const resolved = path.isAbsolute(keyPath)
      ? keyPath
      : path.join(process.cwd(), keyPath);
    const fileContent = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(fileContent);
  }

  throw new Error('No se encontraron credenciales de Google Service Account. Define GOOGLE_SERVICE_ACCOUNT_KEY o GOOGLE_SERVICE_ACCOUNT_PATH.');
}

function generateJWT(serviceAccountKey) {
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccountKey.client_email,
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/presentations',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const message = `${encodedHeader}.${encodedPayload}`;

  const signature = signMessage(message, serviceAccountKey.private_key);
  return `${message}.${signature}`;
}

function signMessage(message, privateKey) {
  let cleanPrivateKey = privateKey;

  if (cleanPrivateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    cleanPrivateKey = cleanPrivateKey
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/\s/g, '');
  }

  const pemKey = `-----BEGIN PRIVATE KEY-----\n${cleanPrivateKey.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  return sign.sign(pemKey, 'base64url');
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && cachedTokenExpiresAt > now + 60_000) {
    return cachedAccessToken;
  }

  const serviceAccountKey = loadServiceAccountKey();
  const jwt = generateJWT(serviceAccountKey);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }).toString()
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Error obteniendo access token: ${data.error_description || data.error}`);
  }

  cachedAccessToken = data.access_token;
  cachedTokenExpiresAt = now + (data.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

function extractFileIdFromUrl(url) {
  if (!url) return null;

  const patterns = [
    /\/file\/d\/([a-zA-Z0-9-_]+)/,
    /\/open\?id=([a-zA-Z0-9-_]+)/,
    /\/d\/([a-zA-Z0-9-_]+)/,
    /id=([a-zA-Z0-9-_]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

async function fetchGuideFromDrive() {
  const fileId = extractFileIdFromUrl(GUIDE_URL);
  if (!fileId) {
    throw new Error('No se pudo extraer el ID del documento de la guía');
  }

  const accessToken = await getAccessToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error obteniendo guía: ${response.status} - ${errorText}`);
  }

  const text = await response.text();
  return text.trim();
}

/**
 * Devuelve el texto de la guía (cacheado por 50 minutos)
 */
export async function getGuideText() {
  const now = Date.now();
  if (cachedGuideText && cachedGuideExpiresAt > now) {
    return cachedGuideText;
  }

  const text = await fetchGuideFromDrive();
  cachedGuideText = text;
  // Cache por 50 minutos
  cachedGuideExpiresAt = now + 50 * 60 * 1000;
  return text;
}

export default {
  getGuideText
};
