import dotenv from 'dotenv';
import { formatPhoneNumber, isValidPhoneNumber } from '../utils/phoneUtils.js';

dotenv.config();

const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN || process.env.HUBSPOT_API_KEY;
const HUBSPOT_BASE = 'https://api.hubapi.com';

if (!HUBSPOT_TOKEN) {
  console.warn('[WARN] No se encontró HUBSPOT_PRIVATE_APP_TOKEN ni HUBSPOT_API_KEY. Los endpoints de importación no funcionarán.');
}

async function hubspotFetch(url, options = {}) {
  if (!HUBSPOT_TOKEN) {
    throw new Error('Configura HUBSPOT_PRIVATE_APP_TOKEN (o HUBSPOT_API_KEY) para usar HubSpot');
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HubSpot API ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Obtiene información básica de la lista (nombre y número de contactos)
 */
export async function getListInfo(listId) {
  // Endpoint legacy porque expone el nombre y total de contactos
  const url = `${HUBSPOT_BASE}/contacts/v1/lists/${listId}`;
  const data = await hubspotFetch(url);

  return {
    id: data.listId || listId,
    name: data.name || 'Lista sin nombre',
    totalContacts: data.meta?.numberOfContacts || data.metadata?.size || 0
  };
}

/**
 * Obtiene los contactos de una lista con las propiedades requeridas
 * Devuelve objetos: { phone, firstname, lastname, raw }
 */
export async function getListContacts(listId) {
  const contacts = [];
  let hasMore = true;
  let vidOffset = undefined;
  const maxPerPage = 200; // límite del endpoint legacy

  while (hasMore) {
    const url = new URL(`${HUBSPOT_BASE}/contacts/v1/lists/${listId}/contacts/all`);
    url.searchParams.set('count', maxPerPage.toString());
    url.searchParams.append('property', 'phone');
    // Fallback común en HubSpot: muchos contactos tienen el teléfono en mobilephone
    url.searchParams.append('property', 'mobilephone');
    url.searchParams.append('property', 'firstname');
    url.searchParams.append('property', 'lastname');
    if (vidOffset) {
      url.searchParams.set('vidOffset', vidOffset.toString());
    }

    const data = await hubspotFetch(url.toString());
    const pageContacts = data.contacts || [];

    for (const c of pageContacts) {
      const props = c.properties || {};
      const phone = props.phone?.value || props.mobilephone?.value;
      const firstname = props.firstname?.value || '';
      const lastname = props.lastname?.value || '';

      // Validar teléfono
      if (!isValidPhoneNumber(phone)) {
        continue;
      }

      const formattedPhone = formatPhoneNumber(phone);
      contacts.push({
        phone: formattedPhone,
        firstname,
        lastname,
        raw: c
      });
    }

    hasMore = data['has-more'] === true;
    vidOffset = data['vid-offset'];
  }

  return contacts;
}

export default {
  getListInfo,
  getListContacts
};
