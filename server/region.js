import { randomUUID } from 'node:crypto';

export const REGION_IDS = Object.freeze(['asia','middle-east','europe','us-east','us-west','south-america','australia']);

const id = (value, fallback) => {
  const v = String(value ?? '').trim().toLowerCase();
  return v || fallback;
};
const text = (value, fallback) => {
  const v = String(value ?? '').trim();
  return v || fallback;
};

export function regionConfig(env=process.env) {
  const regionId = id(env.REGION_ID, 'local');
  const serverId = id(env.SERVER_ID, `${regionId}-${process.pid}`);
  const publicWsUrl = text(env.PUBLIC_WS_URL, '');
  const publicHttpUrl = text(env.PUBLIC_HTTP_URL, '');
  const maxClients = Number.isInteger(Number(env.MAX_CLIENTS)) && Number(env.MAX_CLIENTS) > 0 ? Number(env.MAX_CLIENTS) : 128;
  return Object.freeze({
    regionId,
    serverId,
    publicWsUrl,
    publicHttpUrl,
    maxClients,
    bootId: randomUUID(),
    startedAt: new Date().toISOString(),
    knownRegions: REGION_IDS
  });
}

export function publicRegionInfo(config, {players=0, rooms=0, healthy=true}={}) {
  return {
    regionId: config.regionId,
    serverId: config.serverId,
    publicWsUrl: config.publicWsUrl || null,
    publicHttpUrl: config.publicHttpUrl || null,
    players,
    rooms,
    healthy: Boolean(healthy)
  };
}
